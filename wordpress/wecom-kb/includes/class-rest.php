<?php
/**
 * REST API used by the front-end (assets/wp-bridge.js).
 *
 *   GET  /wp-json/wecom-kb/v1/library        current library + history list
 *   POST /wp-json/wecom-kb/v1/library        save a new version
 *   GET  /wp-json/wecom-kb/v1/history        version history list
 *   GET  /wp-json/wecom-kb/v1/history/{id}   one past version's full library
 */

defined( 'ABSPATH' ) || exit;

class Wecom_KB_Rest {

	const NS = 'wecom-kb/v1';

	public static function register_routes() {
		$can_view = function () {
			return current_user_can( wecom_kb_view_cap() );
		};
		$can_edit = function () {
			return current_user_can( wecom_kb_edit_cap() );
		};

		register_rest_route(
			self::NS,
			'/library',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( __CLASS__, 'get_library' ),
					'permission_callback' => $can_view,
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( __CLASS__, 'save_library' ),
					'permission_callback' => $can_edit,
					'args'                => array(
						'label'        => array(
							'type'    => 'string',
							'default' => '',
						),
						'base_version' => array(
							'type'    => 'integer',
							'default' => 0,
						),
						'force'        => array(
							'type'    => 'boolean',
							'default' => false,
						),
					),
				),
			)
		);

		register_rest_route(
			self::NS,
			'/history',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => function () {
					return rest_ensure_response( Wecom_KB_Store::history_list() );
				},
				'permission_callback' => $can_view,
			)
		);

		register_rest_route(
			self::NS,
			'/history/(?P<id>\d+)',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'get_version' ),
				'permission_callback' => $can_edit,
			)
		);
	}

	public static function get_library() {
		$current = Wecom_KB_Store::current();
		return rest_ensure_response(
			array(
				'version' => $current ? $current['id'] : 0,
				'library' => $current ? $current['data'] : null,
				'history' => Wecom_KB_Store::history_list(),
			)
		);
	}

	public static function save_library( WP_REST_Request $request ) {
		// Read the raw body so JSON objects stay objects ({} vs []).
		$body = json_decode( $request->get_body() );
		if ( ! is_object( $body ) || ! isset( $body->state ) ) {
			return new WP_Error( 'wecom_kb_invalid', 'בקשה לא תקינה.', array( 'status' => 400 ) );
		}

		$sanitizer = new Wecom_KB_Sanitizer();
		$state     = $sanitizer->library( $body->state );
		if ( is_wp_error( $state ) ) {
			return $state;
		}

		$id = Wecom_KB_Store::save(
			$state,
			$request['label'] ? $request['label'] : 'עדכון בספרייה',
			$request['base_version'],
			$request['force']
		);
		if ( is_wp_error( $id ) ) {
			return $id;
		}

		return rest_ensure_response(
			array(
				'version'      => $id,
				'history_item' => Wecom_KB_Store::history_item( $id ),
				// Lets the client swap the base64 images it still holds in
				// memory for their new Media Library URLs.
				'images'       => (object) $sanitizer->images(),
			)
		);
	}

	public static function get_version( WP_REST_Request $request ) {
		$row = Wecom_KB_Store::get( (int) $request['id'] );
		if ( ! $row ) {
			return new WP_Error( 'wecom_kb_not_found', 'הגרסה לא נמצאה.', array( 'status' => 404 ) );
		}
		return rest_ensure_response(
			array(
				'id'      => $row['id'],
				'library' => $row['data'],
			)
		);
	}
}

// REST nonces expire after ~24h. An agent who leaves the tab open overnight
// would otherwise get "cookie nonce invalid" on their next save; the bridge
// fetches a fresh one from here (cookie-authenticated, same-origin only).
add_action( 'wp_ajax_wecom_kb_nonce', function () {
	wp_send_json_success( array( 'nonce' => wp_create_nonce( 'wp_rest' ) ) );
} );
