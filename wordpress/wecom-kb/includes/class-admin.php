<?php
/**
 * Tools → wecom מאגר ידע
 * Status, export of the live library, and import (used once to move the
 * content people created on the GitHub Pages version into WordPress).
 */

defined( 'ABSPATH' ) || exit;

class Wecom_KB_Admin {

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_post_wecom_kb_export', array( __CLASS__, 'export' ) );
		add_action( 'admin_post_wecom_kb_import', array( __CLASS__, 'import' ) );
	}

	public static function menu() {
		add_management_page( 'wecom מאגר ידע', 'wecom מאגר ידע', 'manage_options', 'wecom-kb', array( __CLASS__, 'render' ) );
	}

	/**
	 * Paste into the browser console on the old GitHub Pages site to
	 * download everything that browser has saved.
	 */
	private static function console_snippet() {
		return "(function(){var g=function(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}};"
			. "var d={topics:g('wecom_kb_topics_v1'),docs:g('wecom_kb_docs_v1')||{},trash:g('wecom_kb_trash_v1')||[],seedVersion:+(localStorage.getItem('wecom_kb_seed_version_v1')||0)};"
			. "if(!d.topics){alert('לא נמצאו נתונים שמורים בדפדפן הזה');return;}"
			. "var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(d)],{type:'application/json'}));"
			. "a.download='wecom-kb-export.json';a.click();})();";
	}

	public static function render() {
		$page_id = (int) get_option( 'wecom_kb_page_id' );
		$current = Wecom_KB_Store::current();
		$latest  = $current ? Wecom_KB_Store::history_item( $current['id'] ) : null;
		$notice  = isset( $_GET['wecom_kb_notice'] ) ? sanitize_text_field( wp_unslash( $_GET['wecom_kb_notice'] ) ) : '';
		?>
		<div class="wrap" dir="rtl">
			<h1>wecom – מאגר ידע פנימי</h1>

			<?php if ( 'imported' === $notice ) : ?>
				<div class="notice notice-success"><p>הייבוא הושלם. הגרסה הקודמת נשמרה בהיסטוריית הגרסאות.</p></div>
			<?php elseif ( $notice ) : ?>
				<div class="notice notice-error"><p><?php echo esc_html( $notice ); ?></p></div>
			<?php endif; ?>

			<h2>סטטוס</h2>
			<table class="widefat striped" style="max-width:640px">
				<tr>
					<th>עמוד האפליקציה</th>
					<td>
						<?php if ( $page_id && get_post( $page_id ) ) : ?>
							<a href="<?php echo esc_url( get_permalink( $page_id ) ); ?>" target="_blank"><?php echo esc_html( get_permalink( $page_id ) ); ?></a>
						<?php else : ?>
							לא הוגדר. צרו עמוד ובחרו בתבנית "wecom – מאגר ידע (מסך מלא)".
						<?php endif; ?>
					</td>
				</tr>
				<tr>
					<th>גרסאות שמורות</th>
					<td><?php echo (int) Wecom_KB_Store::count(); ?></td>
				</tr>
				<tr>
					<th>שמירה אחרונה</th>
					<td>
						<?php
						if ( $latest ) {
							echo esc_html( wp_date( 'd/m/Y H:i', (int) ( $latest['ts'] / 1000 ) ) . ' · ' . $latest['author'] . ' · ' . $latest['label'] );
						} else {
							echo 'עדיין אין נתונים. התוכן ההתחלתי ייטען בכניסה הראשונה של עורך לאפליקציה.';
						}
						?>
					</td>
				</tr>
			</table>

			<h2>ייצוא</h2>
			<p>הורדת הספרייה הנוכחית כקובץ JSON (גיבוי).</p>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="wecom_kb_export">
				<?php wp_nonce_field( 'wecom_kb_export' ); ?>
				<?php submit_button( 'הורדת קובץ JSON', 'secondary', 'submit', false ); ?>
			</form>

			<h2>ייבוא</h2>
			<p>מחליף את הספרייה הנוכחית בתוכן הקובץ. הגרסה הנוכחית לא נמחקת, אלא נשמרת בהיסטוריה וניתן לשחזר אותה מתוך האפליקציה.</p>
			<details style="margin-bottom:12px;max-width:760px">
				<summary><strong>איך מוציאים את התוכן מהגרסה הישנה (GitHub Pages)?</strong></summary>
				<ol>
					<li>פתחו את האתר הישן בדפדפן שבו נוצר התוכן (הנתונים שמורים רק בדפדפן הזה).</li>
					<li>לחצו F12 ועברו ללשונית Console.</li>
					<li>הדביקו את השורה הבאה ולחצו Enter. יירד קובץ בשם <code>wecom-kb-export.json</code>.</li>
				</ol>
				<textarea readonly rows="5" style="width:100%;direction:ltr;font-family:monospace;font-size:12px" onclick="this.select()"><?php echo esc_textarea( self::console_snippet() ); ?></textarea>
			</details>
			<form method="post" enctype="multipart/form-data" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="wecom_kb_import">
				<?php wp_nonce_field( 'wecom_kb_import' ); ?>
				<input type="file" name="wecom_kb_file" accept=".json,application/json" required>
				<?php submit_button( 'ייבוא', 'primary', 'submit', false ); ?>
			</form>
		</div>
		<?php
	}

	public static function export() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'אין הרשאה.', 403 );
		}
		check_admin_referer( 'wecom_kb_export' );

		$current = Wecom_KB_Store::current();
		nocache_headers();
		header( 'Content-Type: application/json; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename="wecom-kb-' . gmdate( 'Y-m-d' ) . '.json"' );
		echo wp_json_encode( $current ? $current['data'] : new stdClass(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT );
		exit;
	}

	public static function import() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'אין הרשאה.', 403 );
		}
		check_admin_referer( 'wecom_kb_import' );

		$back = admin_url( 'tools.php?page=wecom-kb' );
		$fail = function ( $msg ) use ( $back ) {
			wp_safe_redirect( add_query_arg( 'wecom_kb_notice', rawurlencode( $msg ), $back ) );
			exit;
		};

		if ( empty( $_FILES['wecom_kb_file']['tmp_name'] ) || ! is_uploaded_file( $_FILES['wecom_kb_file']['tmp_name'] ) ) {
			$fail( 'לא התקבל קובץ.' );
		}

		$state = json_decode( file_get_contents( $_FILES['wecom_kb_file']['tmp_name'] ) );
		if ( null === $state ) {
			$fail( 'הקובץ אינו JSON תקין.' );
		}

		$sanitizer = new Wecom_KB_Sanitizer();
		$state     = $sanitizer->library( $state );
		if ( is_wp_error( $state ) ) {
			$fail( $state->get_error_message() );
		}

		$id = Wecom_KB_Store::save( $state, 'ייבוא מקובץ', 0, true );
		if ( is_wp_error( $id ) ) {
			$fail( $id->get_error_message() );
		}

		wp_safe_redirect( add_query_arg( 'wecom_kb_notice', 'imported', $back ) );
		exit;
	}
}
