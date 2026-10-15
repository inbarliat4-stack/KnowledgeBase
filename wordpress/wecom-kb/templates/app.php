<?php
/**
 * Full-screen template for the knowledge base app.
 *
 * Deliberately does not call wp_head()/wp_footer(): the app ships its own
 * complete design, and theme styles would clash with it. Order matters:
 * boot data → app.js (original app) → wp-bridge.js (replaces its
 * localStorage persistence) — all before DOMContentLoaded fires.
 */

defined( 'ABSPATH' ) || exit;

if ( ! is_user_logged_in() ) {
	auth_redirect();
}
if ( ! current_user_can( wecom_kb_view_cap() ) ) {
	wp_die( 'אין לך הרשאה לצפות במאגר הידע.', 'wecom', array( 'response' => 403 ) );
}

nocache_headers();
$wecom_kb_boot = wecom_kb_boot_data();
$wecom_kb_flags = JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE;
?><!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>wecom | מאגר ידע</title>
<link href="https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="<?php echo esc_url( wecom_kb_asset_url( 'app.css' ) ); ?>">
<link rel="stylesheet" href="<?php echo esc_url( wecom_kb_asset_url( 'wp-bridge.css' ) ); ?>">
<script>window.WECOM_KB = <?php echo wp_json_encode( $wecom_kb_boot, $wecom_kb_flags ); ?>;
window.WECOM_KB.ajaxUrl = <?php echo wp_json_encode( admin_url( 'admin-ajax.php' ) ); ?>;</script>
<script src="<?php echo esc_url( wecom_kb_asset_url( 'app.js' ) ); ?>"></script>
<script src="<?php echo esc_url( wecom_kb_asset_url( 'wp-bridge.js' ) ); ?>"></script>
</head>
<body class="<?php echo $wecom_kb_boot['canEdit'] ? 'wkb-can-edit' : 'wkb-readonly'; ?>">
<?php
// The app markup, extracted verbatim from index.html by build.js.
readfile( WECOM_KB_DIR . 'templates/app-body.html' );
?>
</body>
</html>
