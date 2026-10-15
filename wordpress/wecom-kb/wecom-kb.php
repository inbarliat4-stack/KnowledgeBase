<?php
/**
 * Plugin Name: wecom – מאגר ידע פנימי
 * Description: פלטפורמת הידע לנציגי שירות ותמיכה של wecom. מוסיף תבנית עמוד "wecom – מאגר ידע" ושומר את הספרייה, סל המיחזור והיסטוריית הגרסאות במסד הנתונים של WordPress.
 * Version:     1.0.0
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Text Domain: wecom-kb
 */

defined( 'ABSPATH' ) || exit;

define( 'WECOM_KB_VERSION', '1.0.0' );
define( 'WECOM_KB_FILE', __FILE__ );
define( 'WECOM_KB_DIR', plugin_dir_path( __FILE__ ) );
define( 'WECOM_KB_URL', plugin_dir_url( __FILE__ ) );
define( 'WECOM_KB_TEMPLATE', 'wecom-kb-app' );

require_once WECOM_KB_DIR . 'includes/class-store.php';
require_once WECOM_KB_DIR . 'includes/class-sanitizer.php';
require_once WECOM_KB_DIR . 'includes/class-rest.php';
require_once WECOM_KB_DIR . 'includes/class-admin.php';

/**
 * Capability needed to open the knowledge base (agents).
 * Filter `wecom_kb_view_cap` to tighten it, e.g. to a custom role.
 */
function wecom_kb_view_cap() {
	return apply_filters( 'wecom_kb_view_cap', 'read' );
}

/**
 * Capability needed to create, edit, delete and restore items.
 * Users without it get a read-only version of the app.
 */
function wecom_kb_edit_cap() {
	return apply_filters( 'wecom_kb_edit_cap', 'edit_posts' );
}

register_activation_hook( __FILE__, 'wecom_kb_activate' );
function wecom_kb_activate() {
	Wecom_KB_Store::install();

	// Create the app page once so the plugin works right after activation.
	$page_id = (int) get_option( 'wecom_kb_page_id' );
	if ( ! $page_id || ! get_post( $page_id ) ) {
		$page_id = wp_insert_post(
			array(
				'post_title'  => 'מאגר ידע',
				'post_name'   => 'kb',
				'post_status' => 'publish',
				'post_type'   => 'page',
			)
		);
		if ( $page_id && ! is_wp_error( $page_id ) ) {
			update_post_meta( $page_id, '_wp_page_template', WECOM_KB_TEMPLATE );
			update_option( 'wecom_kb_page_id', $page_id );
		}
	}
}

add_action( 'plugins_loaded', array( 'Wecom_KB_Store', 'maybe_upgrade' ) );
add_action( 'rest_api_init', array( 'Wecom_KB_Rest', 'register_routes' ) );
Wecom_KB_Admin::init();

// ── Page template ───────────────────────────────────────────────────────────
// Any page can be turned into the knowledge base by picking this template.
// The app is rendered full-screen, without the theme's header/footer.

add_filter( 'theme_page_templates', function ( $templates ) {
	$templates[ WECOM_KB_TEMPLATE ] = 'wecom – מאגר ידע (מסך מלא)';
	return $templates;
} );

add_filter( 'template_include', function ( $template ) {
	if ( is_singular( 'page' ) && get_page_template_slug() === WECOM_KB_TEMPLATE ) {
		return WECOM_KB_DIR . 'templates/app.php';
	}
	return $template;
}, 99 );

// The page itself is published (the template sends logged-out visitors to
// the login screen and holds no content of its own); keep it out of the
// public sitemap.
add_filter( 'wp_sitemaps_posts_query_args', function ( $args, $post_type ) {
	if ( 'page' === $post_type ) {
		$args['meta_query']   = isset( $args['meta_query'] ) ? $args['meta_query'] : array();
		$args['meta_query'][] = array(
			'relation' => 'OR',
			array(
				'key'     => '_wp_page_template',
				'value'   => WECOM_KB_TEMPLATE,
				'compare' => '!=',
			),
			array(
				'key'     => '_wp_page_template',
				'compare' => 'NOT EXISTS',
			),
		);
	}
	return $args;
}, 10, 2 );

/**
 * Everything the front-end needs on first paint, inlined into the page so
 * the existing synchronous start-up code keeps working unchanged.
 */
function wecom_kb_boot_data() {
	$current = Wecom_KB_Store::current();
	$user    = wp_get_current_user();

	return array(
		'restUrl'   => esc_url_raw( rest_url( 'wecom-kb/v1/' ) ),
		'nonce'     => wp_create_nonce( 'wp_rest' ),
		'canEdit'   => current_user_can( wecom_kb_edit_cap() ),
		'user'      => array(
			'id'   => $user->ID,
			'name' => $user->display_name,
		),
		'version'   => $current ? (int) $current['id'] : 0,
		'library'   => $current ? $current['data'] : null,
		'history'   => Wecom_KB_Store::history_list(),
		'logoutUrl' => wp_logout_url( get_permalink() ),
	);
}

function wecom_kb_asset_url( $file ) {
	$path = WECOM_KB_DIR . 'assets/' . $file;
	$ver  = file_exists( $path ) ? filemtime( $path ) : WECOM_KB_VERSION;
	return WECOM_KB_URL . 'assets/' . $file . '?ver=' . $ver;
}
