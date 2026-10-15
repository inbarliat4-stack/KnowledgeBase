<?php
/**
 * Persistence for the knowledge base.
 *
 * The front-end works with one JSON "library" document:
 *   { topics: [...], docs: {...}, trash: [...], seedVersion: n }
 *
 * Every save inserts a new row, so the table doubles as the version history
 * that used to live in each browser's localStorage. The newest row is the
 * live library. Old rows are pruned past `wecom_kb_history_max`.
 */

defined( 'ABSPATH' ) || exit;

class Wecom_KB_Store {

	const DB_VERSION = 1;
	const LOCK       = 'wecom_kb_save';

	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'wecom_kb_versions';
	}

	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$table   = self::table();
		$charset = $wpdb->get_charset_collate();

		dbDelta(
			"CREATE TABLE {$table} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				created_at datetime NOT NULL,
				user_id bigint(20) unsigned NOT NULL DEFAULT 0,
				label varchar(255) NOT NULL DEFAULT '',
				data longtext NOT NULL,
				PRIMARY KEY  (id),
				KEY created_at (created_at)
			) {$charset};"
		);

		update_option( 'wecom_kb_db_version', self::DB_VERSION );
	}

	public static function maybe_upgrade() {
		if ( (int) get_option( 'wecom_kb_db_version' ) !== self::DB_VERSION ) {
			self::install();
		}
	}

	public static function latest_id() {
		global $wpdb;
		return (int) $wpdb->get_var( 'SELECT MAX(id) FROM ' . self::table() );
	}

	/**
	 * @return array|null { id, data (decoded, objects preserved), created_at, user_id, label }
	 */
	public static function get( $id ) {
		global $wpdb;
		$row = $wpdb->get_row(
			$wpdb->prepare( 'SELECT * FROM ' . self::table() . ' WHERE id = %d', $id ),
			ARRAY_A
		);
		return $row ? self::hydrate( $row ) : null;
	}

	public static function current() {
		global $wpdb;
		$row = $wpdb->get_row( 'SELECT * FROM ' . self::table() . ' ORDER BY id DESC LIMIT 1', ARRAY_A );
		return $row ? self::hydrate( $row ) : null;
	}

	private static function hydrate( $row ) {
		// Decode to stdClass so empty JSON objects ({}) survive the round
		// trip instead of turning into arrays ([]).
		$row['id']   = (int) $row['id'];
		$row['data'] = json_decode( $row['data'] );
		return $row;
	}

	/**
	 * Saves a new version, refusing if someone else saved since $base_id.
	 *
	 * @param object $state   Already-sanitized library state.
	 * @param string $label   Human description shown in version history.
	 * @param int    $base_id The version the client's change was made on top of.
	 * @param bool   $force   Save even if a newer version exists (it stays in history).
	 * @return int|WP_Error New version id.
	 */
	public static function save( $state, $label, $base_id, $force = false ) {
		global $wpdb;

		$json = wp_json_encode( $state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
		if ( false === $json ) {
			return new WP_Error( 'wecom_kb_encode', 'לא ניתן לשמור את הנתונים.', array( 'status' => 400 ) );
		}

		// Serialize the check-then-insert so two editors saving at the same
		// moment can't both pass the conflict check.
		$locked = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, 10)', self::LOCK ) );
		if ( ! $locked ) {
			return new WP_Error( 'wecom_kb_busy', 'השרת עסוק, נסו שוב.', array( 'status' => 503 ) );
		}

		try {
			$latest = self::latest_id();
			if ( ! $force && $latest && (int) $base_id !== $latest ) {
				$current = self::history_item( $latest );
				return new WP_Error(
					'wecom_kb_conflict',
					'הספרייה עודכנה בינתיים על ידי משתמש אחר.',
					array(
						'status'  => 409,
						'version' => $latest,
						'latest'  => $current,
					)
				);
			}

			$ok = $wpdb->insert(
				self::table(),
				array(
					'created_at' => current_time( 'mysql', true ),
					'user_id'    => get_current_user_id(),
					'label'      => mb_substr( sanitize_text_field( $label ), 0, 255 ),
					'data'       => $json,
				),
				array( '%s', '%d', '%s', '%s' )
			);
			if ( ! $ok ) {
				return new WP_Error( 'wecom_kb_db', 'השמירה נכשלה.', array( 'status' => 500 ) );
			}
			$id = (int) $wpdb->insert_id;
		} finally {
			$wpdb->query( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', self::LOCK ) );
		}

		self::prune();
		return $id;
	}

	private static function prune() {
		global $wpdb;
		$max = max( 1, (int) apply_filters( 'wecom_kb_history_max', 200 ) );
		$cut = (int) $wpdb->get_var(
			$wpdb->prepare( 'SELECT id FROM ' . self::table() . ' ORDER BY id DESC LIMIT 1 OFFSET %d', $max - 1 )
		);
		if ( $cut ) {
			$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . self::table() . ' WHERE id < %d', $cut ) );
		}
	}

	public static function count() {
		global $wpdb;
		return (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . self::table() );
	}

	/**
	 * Version history in the shape the front-end expects (oldest first).
	 */
	public static function history_list() {
		global $wpdb;
		$limit = max( 1, (int) apply_filters( 'wecom_kb_history_list_size', 100 ) );
		$rows  = $wpdb->get_results(
			$wpdb->prepare( 'SELECT id, created_at, user_id, label FROM ' . self::table() . ' ORDER BY id DESC LIMIT %d', $limit ),
			ARRAY_A
		);
		return array_reverse( array_map( array( __CLASS__, 'format_history_row' ), $rows ) );
	}

	public static function history_item( $id ) {
		global $wpdb;
		$row = $wpdb->get_row(
			$wpdb->prepare( 'SELECT id, created_at, user_id, label FROM ' . self::table() . ' WHERE id = %d', $id ),
			ARRAY_A
		);
		return $row ? self::format_history_row( $row ) : null;
	}

	private static function format_history_row( $row ) {
		$user = $row['user_id'] ? get_userdata( (int) $row['user_id'] ) : null;
		return array(
			'id'     => (int) $row['id'],
			'ts'     => strtotime( $row['created_at'] . ' UTC' ) * 1000,
			'label'  => $row['label'],
			'author' => $user ? $user->display_name : '',
		);
	}
}
