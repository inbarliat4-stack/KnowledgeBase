<?php
/**
 * Source-document import (spec §8): an editor uploads the source document
 * (PDF, PNG, Word or text) and Claude converts it into a draft knowledge item in
 * the app's structure. The draft is never published automatically — the
 * editor reviews it in the app and approves it.
 *
 *   POST /wp-json/wecom-kb/v1/import   (multipart: file, kind, catalog, current)
 *     → { draft, source: {id, url, name}, usage }
 *
 * The uploaded file is kept in the Media Library as the item's source
 * document. Its text is sent to the Anthropic API for the conversion.
 */

defined( 'ABSPATH' ) || exit;

class Wecom_KB_Importer {

	const MODEL       = 'claude-opus-5-5';
	const MAX_BYTES   = 20 * MB_IN_BYTES; // API request limit is 32 MB, base64 adds ~33%
	const OPTION_KEY  = 'wecom_kb_anthropic_key';

	/** API key: a WECOM_KB_ANTHROPIC_KEY constant in wp-config.php wins over the setting. */
	public static function api_key() {
		if ( defined( 'WECOM_KB_ANTHROPIC_KEY' ) && WECOM_KB_ANTHROPIC_KEY ) {
			return WECOM_KB_ANTHROPIC_KEY;
		}
		return (string) get_option( self::OPTION_KEY, '' );
	}

	public static function enabled() {
		return '' !== self::api_key();
	}

	public static function register_routes() {
		register_rest_route(
			Wecom_KB_Rest::NS,
			'/import',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'handle' ),
				'permission_callback' => function () {
					return current_user_can( wecom_kb_edit_cap() ) && current_user_can( 'upload_files' );
				},
			)
		);
	}

	public static function handle( WP_REST_Request $request ) {
		if ( ! self::enabled() ) {
			return new WP_Error( 'wecom_kb_no_key', 'המרת מסמכים לא הוגדרה: יש להזין מפתח API בהגדרות התוסף (כלים ← wecom מאגר ידע).', array( 'status' => 400 ) );
		}
		$files = $request->get_file_params();
		if ( empty( $files['file']['tmp_name'] ) || ! is_uploaded_file( $files['file']['tmp_name'] ) ) {
			return new WP_Error( 'wecom_kb_no_file', 'לא התקבל קובץ.', array( 'status' => 400 ) );
		}
		$file = $files['file'];
		if ( $file['size'] > self::MAX_BYTES ) {
			return new WP_Error( 'wecom_kb_too_big', 'הקובץ גדול מדי (עד 20MB).', array( 'status' => 400 ) );
		}

		$ext = strtolower( pathinfo( $file['name'], PATHINFO_EXTENSION ) );
		if ( ! in_array( $ext, array( 'pdf', 'png', 'docx', 'txt' ), true ) ) {
			return new WP_Error( 'wecom_kb_type', 'אפשר להעלות PDF, PNG, Word (docx) או קובץ טקסט.', array( 'status' => 400 ) );
		}

		// The document content block for the API.
		$bytes = file_get_contents( $file['tmp_name'] );
		if ( 'png' === $ext ) {
			$image = getimagesize( $file['tmp_name'] );
			if ( ! is_array( $image ) || 'image/png' !== $image['mime'] ) {
				return new WP_Error( 'wecom_kb_type', 'הקובץ אינו תמונת PNG תקינה.', array( 'status' => 400 ) );
			}
			$doc_block = array(
				'type'   => 'image',
				'source' => array(
					'type'       => 'base64',
					'media_type' => 'image/png',
					'data'       => base64_encode( $bytes ),
				),
			);
		} elseif ( 'pdf' === $ext ) {
			if ( 0 !== strpos( $bytes, '%PDF' ) ) {
				return new WP_Error( 'wecom_kb_type', 'הקובץ אינו PDF תקין.', array( 'status' => 400 ) );
			}
			$doc_block = array(
				'type'   => 'document',
				'source' => array(
					'type'       => 'base64',
					'media_type' => 'application/pdf',
					'data'       => base64_encode( $bytes ),
				),
			);
		} else {
			$text = 'docx' === $ext ? self::docx_to_text( $file['tmp_name'] ) : $bytes;
			if ( is_wp_error( $text ) ) {
				return $text;
			}
			$text = trim( wp_check_invalid_utf8( (string) $text, true ) );
			if ( '' === $text ) {
				return new WP_Error( 'wecom_kb_empty', 'לא נמצא טקסט בקובץ.', array( 'status' => 400 ) );
			}
			$doc_block = array(
				'type' => 'text',
				'text' => "<source_document>\n" . $text . "\n</source_document>",
			);
		}

		// Keep the original as the item's source document (Media Library).
		$source = self::store_source( $file );
		if ( is_wp_error( $source ) ) {
			return $source;
		}

		$kind    = preg_replace( '/[^MROESTI]/', '', strtoupper( (string) $request['kind'] ) );
		$catalog = mb_substr( wp_strip_all_tags( (string) $request['catalog'] ), 0, 20000 );
		$current = mb_substr( (string) $request['current'], 0, 60000 );

		$result = self::convert( $doc_block, $kind, $catalog, $current );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return rest_ensure_response(
			array(
				'draft'  => $result['draft'],
				'source' => $source,
				'usage'  => $result['usage'],
			)
		);
	}

	/**
	 * Word → plain text that keeps the structure the conversion needs:
	 * headings ("# "), list items ("• "), table rows ("a | b"), highlighted
	 * text (⟦…⟧ — the writers mark open items this way) and comments.
	 */
	public static function docx_to_text( $path ) {
		if ( ! class_exists( 'ZipArchive' ) ) {
			return new WP_Error( 'wecom_kb_zip', 'השרת אינו תומך בקבצי Word (חסר ZipArchive). אפשר להעלות PDF.', array( 'status' => 500 ) );
		}
		$zip = new ZipArchive();
		if ( true !== $zip->open( $path ) ) {
			return new WP_Error( 'wecom_kb_docx', 'לא ניתן לפתוח את קובץ ה-Word.', array( 'status' => 400 ) );
		}
		$xml      = $zip->getFromName( 'word/document.xml' );
		$comments = $zip->getFromName( 'word/comments.xml' );
		$zip->close();
		if ( ! $xml ) {
			return new WP_Error( 'wecom_kb_docx', 'קובץ ה-Word אינו תקין.', array( 'status' => 400 ) );
		}

		$out = array();
		// Tables first: one line per row.
		$xml = preg_replace_callback(
			'#<w:tbl>.*?</w:tbl>#s',
			function ( $t ) {
				$rows = array();
				preg_match_all( '#<w:tr[ >].*?</w:tr>#s', $t[0], $trs );
				foreach ( $trs[0] as $tr ) {
					preg_match_all( '#<w:tc>.*?</w:tc>#s', $tr, $tcs );
					$cells = array_map( array( __CLASS__, 'runs_text' ), $tcs[0] );
					$rows[] = implode( ' | ', array_map( 'trim', $cells ) );
				}
				return '<w:p><w:r><w:t>' . esc_html( implode( "\n", $rows ) ) . '</w:t></w:r></w:p>';
			},
			$xml
		);
		preg_match_all( '#<w:p[ >].*?</w:p>#s', $xml, $ps );
		foreach ( $ps[0] as $p ) {
			$text = trim( self::runs_text( $p ) );
			if ( '' === $text ) {
				continue;
			}
			if ( preg_match( '#<w:pStyle w:val="([^"]+)"#', $p, $st ) && preg_match( '#^(Heading|Title|כותרת)#iu', $st[1] ) ) {
				$text = '# ' . $text;
			} elseif ( false !== strpos( $p, '<w:numPr>' ) ) {
				$text = '• ' . $text;
			}
			$out[] = $text;
		}
		if ( $comments ) {
			preg_match_all( '#<w:comment [^>]*>.*?</w:comment>#s', $comments, $cs );
			$notes = array_filter( array_map( 'trim', array_map( array( __CLASS__, 'runs_text' ), $cs[0] ) ) );
			if ( $notes ) {
				$out[] = "\n# הערות שוליים במסמך";
				foreach ( $notes as $n ) {
					$out[] = '• ' . $n;
				}
			}
		}
		return implode( "\n", $out );
	}

	/** Text of the runs inside a Word fragment; highlighted runs wrapped in ⟦…⟧. */
	public static function runs_text( $fragment ) {
		$text = '';
		preg_match_all( '#<w:r[ >].*?</w:r>#s', $fragment, $runs );
		foreach ( $runs[0] as $r ) {
			preg_match_all( '#<w:t(?: [^>]*)?>(.*?)</w:t>#s', $r, $ts );
			$piece = html_entity_decode( implode( '', $ts[1] ), ENT_QUOTES | ENT_XML1, 'UTF-8' );
			if ( false !== strpos( $r, '<w:tab/>' ) ) {
				$piece = ' ' . $piece;
			}
			if ( '' !== trim( $piece ) && preg_match( '#<w:(highlight|shd) [^>]*w:(val|fill)="(?!none|auto|FFFFFF)[^"]+"#i', $r ) ) {
				$piece = '⟦' . $piece . '⟧';
			}
			$text .= $piece;
		}
		return str_replace( '⟧⟦', '', $text );
	}

	private static function store_source( $file ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';
		$moved = wp_handle_upload(
			$file,
			array(
				'test_form' => false,
				'mimes'     => array(
					'pdf'  => 'application/pdf',
					'png'  => 'image/png',
					'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
					'txt'  => 'text/plain',
				),
			)
		);
		if ( ! empty( $moved['error'] ) ) {
			return new WP_Error( 'wecom_kb_upload', 'שמירת הקובץ נכשלה: ' . $moved['error'], array( 'status' => 500 ) );
		}
		$id = wp_insert_attachment(
			array(
				'post_mime_type' => $moved['type'],
				'post_title'     => sanitize_text_field( pathinfo( $file['name'], PATHINFO_FILENAME ) ),
				'post_status'    => 'inherit',
			),
			$moved['file']
		);
		if ( ! $id || is_wp_error( $id ) ) {
			return new WP_Error( 'wecom_kb_upload', 'שמירת הקובץ נכשלה.', array( 'status' => 500 ) );
		}
		update_post_meta( $id, '_wecom_kb_source', 1 );
		return array(
			'id'   => (int) $id,
			'url'  => wp_get_attachment_url( $id ),
			'name' => sanitize_file_name( $file['name'] ),
		);
	}

	// ── Conversion ──────────────────────────────────────────────────────────

	private static function system_prompt() {
		return <<<'TXT'
You convert wecom's internal support documents (Hebrew) into knowledge items for the agents' knowledge-base app. Agents read these items live, during customer calls, so the result must be faithful, complete and easy to follow.

Document types (choose the one that fits the source; if the user message names a type, use it):
- M  Central/diagnosis document: entry point that identifies the case and routes to the right handling route. Write it as questions with answers; each answer leads to another question (go_question = its index), to another document by its code (go_code, e.g. "R-02"), or ends with an instruction (note).
- R  Handling route: full handling of a defined scenario, from questioning to resolution or hand-off. Write it as ordered stages, each with short action items.
- S  Specialist route: same shape as R, for a specialist or advanced tier.
- O  Operations document: how to perform a specific action in a system, device or process. Write it as groups (e.g. per device manufacturer) of numbered steps.
- E  Escalation document: when to stop handling, to whom to transfer, which conditions must hold, what must be documented. Use the four sections, plus extra sections for anything else.
- T  Call scripts: wording for the agent to say. Group by situation; each line is one wording. Prefix key anchor sentences with "עוגן: ".
- I  Information document: knowledge to know or pass on, without a troubleshooting process. Write it as simple HTML (h3, h4, p, ul, ol, li, b, table).

Rules:
- Stay faithful to the source. Do not invent steps, values, names, paths or numbers. Keep the source's wording where possible; tighten only for readability.
- Keep document codes exactly as written in the reference form "R-01", "O-02", "E-01", "M-00", "H-02" (fix reversed forms such as "-01R" to "R-01"). The app turns these codes into links, so mention them where the source refers to another document. Use the catalog in the user message to match references to existing documents.
- Missing or still-open content (empty sections, "to be completed", highlighted text marked ⟦…⟧, comments asking someone to complete it): write it as an item that starts with "⚠ חסר: " followed by what is missing. Never fill the gap yourself.
- Remove notes addressed to the author or editor rather than to the agent (e.g. "according to the source document", "I could not confirm", "the official guidelines state"), keeping any real instruction they contain.
- Arrows: write sequences/paths in Hebrew order with "←" (e.g. "הגדרות ← סלולרי ← נתונים סלולריים"). For conditions use "מצב: פעולה".
- If the source document has a code (e.g. "R-03"), put it in "code"; the title must not repeat the code.
- In "issues", list for the editor (in Hebrew) every problem you noticed: contradictions, wrong or broken references, numbering that does not match the catalog, missing documents that are referenced, removed author notes, anything you were unsure about. Empty list if none.
- Fill only the fields of the chosen type; leave the others empty (empty string, empty list, or empty object values).
- When the user message includes the current version of the item, the source is an update of that item: produce the complete new version from the source (not a diff), and in "issues" also summarise what changed compared with the current version.
TXT;
	}

	/** JSON schema for the draft (structured outputs: every object closed, every field required). */
	public static function schema() {
		$str   = array( 'type' => 'string' );
		$lines = array( 'type' => 'array', 'items' => $str );
		$obj   = function ( $props ) {
			return array(
				'type'                 => 'object',
				'properties'           => $props,
				'required'             => array_keys( $props ),
				'additionalProperties' => false,
			);
		};
		return $obj(
			array(
				'kind'       => array( 'type' => 'string', 'enum' => array( 'M', 'R', 'O', 'E', 'S', 'T', 'I' ) ),
				'code'       => $str,
				'title'      => $str,
				'desc'       => $str,
				'tags'       => $lines,
				'stages'     => array( 'type' => 'array', 'items' => $obj( array( 'title' => $str, 'items' => $lines ) ) ),
				'groups'     => array( 'type' => 'array', 'items' => $obj( array( 'title' => $str, 'steps' => $lines ) ) ),
				'html'       => $str,
				'scripts'    => array( 'type' => 'array', 'items' => $obj( array( 'situation' => $str, 'lines' => $lines ) ) ),
				'escalation' => $obj(
					array(
						'when'       => $lines,
						'to'         => $lines,
						'conditions' => $lines,
						'document'   => $lines,
						'extra'      => array( 'type' => 'array', 'items' => $obj( array( 'title' => $str, 'lines' => $lines ) ) ),
					)
				),
				'diagnosis'  => $obj(
					array(
						'intro'     => $lines,
						'questions' => array(
							'type'  => 'array',
							'items' => $obj(
								array(
									'q'       => $str,
									'hint'    => $str,
									'answers' => array(
										'type'  => 'array',
										'items' => $obj(
											array(
												'text'        => $str,
												'note'        => $str,
												'go_question' => array( 'type' => 'integer' ),
												'go_code'     => $str,
											)
										),
									),
								)
							),
						),
						'outro'     => $lines,
					)
				),
				'issues'     => $lines,
			)
		);
	}

	private static function convert( $doc_block, $kind, $catalog, $current ) {
		$ask = "Convert the source document above into one knowledge item.\n";
		if ( $kind ) {
			$ask .= "Document type: {$kind}.\n";
		}
		$ask .= "\nRules for diagnosis answers: go_question is the 0-based index of the next question, or -1. go_code is a document code such as \"R-02\", or \"\". Both -1 and \"\" mean the flow ends with the note.\n";
		if ( $catalog ) {
			$ask .= "\n<catalog>\nExisting knowledge items (code · title · type):\n{$catalog}\n</catalog>\n";
		}
		if ( $current ) {
			$ask .= "\n<current_version>\n{$current}\n</current_version>\n";
		}

		$body = array(
			'model'         => self::MODEL,
			'max_tokens'    => 32000,
			// Thinking is always on for this model; effort sets its depth.
			'output_config' => array(
				'effort' => 'high',
				'format' => array(
					'type'   => 'json_schema',
					'schema' => self::schema(),
				),
			),
			// If a safety classifier declines, the API re-runs on its recommended fallback model.
			'fallbacks'     => 'default',
			'system'        => self::system_prompt(),
			'messages'      => array(
				array(
					'role'    => 'user',
					'content' => array( $doc_block, array( 'type' => 'text', 'text' => $ask ) ),
				),
			),
		);

		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 900 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		}
		$response = wp_remote_post(
			apply_filters( 'wecom_kb_anthropic_endpoint', 'https://api.anthropic.com/v1/messages' ),
			array(
				'timeout' => 600,
				'headers' => array(
					'content-type'      => 'application/json',
					'x-api-key'         => self::api_key(),
					'anthropic-version' => '2023-06-01',
					'anthropic-beta'    => 'server-side-fallback-2026-07-01',
				),
				'body'    => wp_json_encode( $body ),
			)
		);
		if ( is_wp_error( $response ) ) {
			return new WP_Error( 'wecom_kb_ai_network', 'אין חיבור לשירות ההמרה: ' . $response->get_error_message(), array( 'status' => 502 ) );
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( 200 !== $code ) {
			$msg = isset( $data['error']['message'] ) ? $data['error']['message'] : 'HTTP ' . $code;
			$map = array(
				401 => 'מפתח ה-API שגוי או לא בתוקף.',
				403 => 'למפתח ה-API אין הרשאה לפעולה הזו.',
				413 => 'הקובץ גדול מדי לשירות ההמרה.',
				429 => 'שירות ההמרה עמוס כרגע. נסו שוב בעוד דקה.',
				529 => 'שירות ההמרה עמוס כרגע. נסו שוב בעוד דקה.',
			);
			return new WP_Error( 'wecom_kb_ai_http', ( isset( $map[ $code ] ) ? $map[ $code ] : 'ההמרה נכשלה.' ) . ' (' . $msg . ')', array( 'status' => 502 ) );
		}

		$stop = isset( $data['stop_reason'] ) ? $data['stop_reason'] : '';
		if ( 'refusal' === $stop ) {
			return new WP_Error( 'wecom_kb_ai_refusal', 'שירות ההמרה סירב לעבד את המסמך. אפשר להזין את התוכן ידנית.', array( 'status' => 422 ) );
		}
		if ( 'max_tokens' === $stop ) {
			return new WP_Error( 'wecom_kb_ai_long', 'המסמך ארוך מדי להמרה אחת. פצלו אותו לכמה מסמכים.', array( 'status' => 422 ) );
		}

		$json = '';
		foreach ( isset( $data['content'] ) ? $data['content'] : array() as $block ) {
			if ( isset( $block['type'] ) && 'text' === $block['type'] ) {
				$json .= $block['text'];
			}
		}
		$draft = json_decode( $json, true );
		if ( ! is_array( $draft ) || empty( $draft['kind'] ) ) {
			return new WP_Error( 'wecom_kb_ai_parse', 'התקבלה תשובה לא תקינה משירות ההמרה. נסו שוב.', array( 'status' => 502 ) );
		}

		return array(
			'draft' => $draft,
			'usage' => isset( $data['usage'] ) ? $data['usage'] : null,
		);
	}
}
