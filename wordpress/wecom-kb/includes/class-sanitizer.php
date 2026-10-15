<?php
/**
 * Cleans a library state before it is stored.
 *
 * The front-end renders titles and step texts with innerHTML, and now that
 * many people share one library, one editor's input runs in everyone else's
 * browser (including administrators'). So, on the server:
 *   - identifier fields are reduced to [A-Za-z0-9_-] (they end up inside
 *     onclick="..." attributes),
 *   - any text containing markup goes through wp_kses_post (same rules as
 *     post content: formatting kept, scripts and event handlers removed),
 *   - base64 images pasted into documents are moved into the Media Library
 *     and replaced by their URL, keeping the database small.
 */

defined( 'ABSPATH' ) || exit;

class Wecom_KB_Sanitizer {

	const MAX_DEPTH = 32;

	/** Keys whose values are identifiers, never displayed text. */
	const ID_KEYS = array( 'id', 'dynId', 'docId', 'trashId', 'cat', 'pri', '_isViewDoc', 'kind', 'worlds' );

	/** Keys whose values are image URLs. */
	const IMAGE_KEYS = array( 'img', 'images' );

	/** @var array data-URL => attachment URL, for images converted in this request. */
	private $images = array();

	public function images() {
		return $this->images;
	}

	/**
	 * @param mixed $state Decoded JSON (objects as stdClass).
	 * @return object|WP_Error
	 */
	public function library( $state ) {
		if ( ! is_object( $state ) || ! isset( $state->topics ) || ! is_array( $state->topics ) ) {
			return new WP_Error( 'wecom_kb_invalid', 'מבנה הנתונים אינו תקין (חסרה רשימת topics).', array( 'status' => 400 ) );
		}

		$clean = (object) array(
			'topics'      => $this->walk( $state->topics, 'topics', 0 ),
			'docs'        => isset( $state->docs ) && ( is_object( $state->docs ) || is_array( $state->docs ) )
				? (object) $this->walk( $state->docs, 'docs', 0 )
				: new stdClass(),
			'trash'       => isset( $state->trash ) && is_array( $state->trash ) ? $this->walk( $state->trash, 'trash', 0 ) : array(),
			'seedVersion' => isset( $state->seedVersion ) ? (int) $state->seedVersion : 0,
		);
		// Content worlds (departments): [{id, name}].
		if ( isset( $state->worlds ) && is_array( $state->worlds ) ) {
			$clean->worlds = array_values(
				array_filter(
					array_map(
						function ( $w ) {
							if ( ! is_object( $w ) || ! isset( $w->id, $w->name ) ) {
								return null;
							}
							return (object) array(
								'id'   => preg_replace( '/[^A-Za-z0-9_\-]/', '', (string) $w->id ),
								'name' => sanitize_text_field( (string) $w->name ),
							);
						},
						$state->worlds
					)
				)
			);
		}

		return $clean;
	}

	private function walk( $value, $key, $depth ) {
		if ( $depth > self::MAX_DEPTH ) {
			return null;
		}

		if ( is_object( $value ) ) {
			$out = new stdClass();
			foreach ( get_object_vars( $value ) as $k => $v ) {
				$safe_key         = is_string( $k ) ? preg_replace( '/[^\p{L}\p{N}_\- ]/u', '', $k ) : $k;
				$out->{$safe_key} = $this->walk( $v, $safe_key, $depth + 1 );
			}
			return $out;
		}

		if ( is_array( $value ) ) {
			$out = array();
			foreach ( $value as $v ) {
				// List items inherit the list's key, so entries of "images"
				// are treated as images.
				$out[] = $this->walk( $v, $key, $depth + 1 );
			}
			return $out;
		}

		if ( is_string( $value ) ) {
			return $this->string( $value, $key );
		}

		if ( is_int( $value ) || is_float( $value ) || is_bool( $value ) || null === $value ) {
			return $value;
		}

		return null;
	}

	private function string( $value, $key ) {
		if ( 0 === strpos( $value, 'data:image/' ) ) {
			return $this->data_image( $value );
		}

		if ( in_array( $key, self::ID_KEYS, true ) ) {
			return preg_replace( '/[^A-Za-z0-9_\-]/', '', $value );
		}

		if ( in_array( $key, self::IMAGE_KEYS, true ) ) {
			return esc_url_raw( $value );
		}

		// Rich text of information documents: move pasted/inserted images to
		// the Media Library first, because wp_kses_post drops data: URLs.
		if ( 'html' === $key ) {
			$value = preg_replace_callback(
				'#(<img\b[^>]*\bsrc\s*=\s*["\'])(data:image/[^"\']+)(["\'])#i',
				function ( $m ) {
					$url = $this->data_image( $m[2] );
					return $url && 0 !== strpos( $url, 'data:' ) ? $m[1] . esc_url( $url ) . $m[3] : $m[1] . $m[3];
				},
				$value
			);
			return wp_kses_post( $value );
		}

		// Plain text is left byte-for-byte (the editor matches step texts
		// against its option list by exact string); only markup is filtered.
		if ( false !== strpos( $value, '<' ) ) {
			return wp_kses_post( $value );
		}

		return $value;
	}

	/**
	 * Moves a base64 image into the Media Library and returns its URL.
	 * Returns null for anything that isn't a real image.
	 */
	private function data_image( $data_url ) {
		if ( isset( $this->images[ $data_url ] ) ) {
			return $this->images[ $data_url ];
		}

		if ( ! preg_match( '#^data:image/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=\s]+)$#', $data_url, $m ) ) {
			return null;
		}

		// Without upload rights keep the inline image (already validated as
		// plain base64 above, so it's safe to render).
		if ( ! current_user_can( 'upload_files' ) ) {
			return $data_url;
		}

		$bytes = base64_decode( $m[2], true );
		$max   = (int) apply_filters( 'wecom_kb_max_image_bytes', 8 * MB_IN_BYTES );
		if ( false === $bytes || strlen( $bytes ) > $max ) {
			return null;
		}

		$hash     = md5( $bytes );
		$existing = get_posts(
			array(
				'post_type'      => 'attachment',
				'post_status'    => 'inherit',
				'meta_key'       => '_wecom_kb_hash',
				'meta_value'     => $hash,
				'fields'         => 'ids',
				'posts_per_page' => 1,
			)
		);
		if ( $existing ) {
			return $this->images[ $data_url ] = wp_get_attachment_url( $existing[0] );
		}

		$ext    = 'jpeg' === $m[1] ? 'jpg' : $m[1];
		$upload = wp_upload_bits( 'wecom-kb-' . substr( $hash, 0, 12 ) . '.' . $ext, null, $bytes );
		if ( ! empty( $upload['error'] ) ) {
			return null;
		}

		$mime = wp_get_image_mime( $upload['file'] );
		if ( ! $mime || 0 !== strpos( $mime, 'image/' ) ) {
			wp_delete_file( $upload['file'] );
			return null;
		}

		$attachment_id = wp_insert_attachment(
			array(
				'post_mime_type' => $mime,
				'post_title'     => 'wecom מאגר ידע – תמונה',
				'post_status'    => 'inherit',
			),
			$upload['file']
		);
		if ( ! $attachment_id || is_wp_error( $attachment_id ) ) {
			wp_delete_file( $upload['file'] );
			return null;
		}

		require_once ABSPATH . 'wp-admin/includes/image.php';
		wp_update_attachment_metadata( $attachment_id, wp_generate_attachment_metadata( $attachment_id, $upload['file'] ) );
		update_post_meta( $attachment_id, '_wecom_kb_hash', $hash );

		return $this->images[ $data_url ] = wp_get_attachment_url( $attachment_id );
	}
}
