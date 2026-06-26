<?php
/**
 * Voxel Play theme — enqueues the built SPA bundle and tells it where its
 * assets (samples/, templates/) live (the theme's /dist/ folder).
 */

if (!defined('ABSPATH')) {
    exit; // no direct access
}

function voxel_play_enqueue_assets() {
    $dist = get_template_directory_uri() . '/dist';
    $dist_path = get_template_directory() . '/dist';

    // CSS + JS are built with stable names (see vite.config.ts).
    $css = $dist_path . '/assets/app.css';
    $js  = $dist_path . '/assets/app.js';

    if (file_exists($css)) {
        wp_enqueue_style('voxel-play', $dist . '/assets/app.css', array(), filemtime($css));
    }
    if (file_exists($js)) {
        // type="module" — added via the script_loader_tag filter below.
        wp_enqueue_script('voxel-play', $dist . '/assets/app.js', array(), filemtime($js), true);
        // Tell the app where to fetch bundled .vox assets, and where to save
        // creations (REST API → WordPress database).
        $boot = 'window.VOXEL_BASE = ' . wp_json_encode($dist . '/') . ';'
            . 'window.VOXEL_API = ' . wp_json_encode(array(
                'base'  => esc_url_raw(rest_url('voxel/v1/')),
                'nonce' => wp_create_nonce('wp_rest'),
            )) . ';';
        wp_add_inline_script('voxel-play', $boot, 'before');
    }
}
add_action('wp_enqueue_scripts', 'voxel_play_enqueue_assets');

// The Vite bundle is an ES module — load it as type="module".
function voxel_play_module_type($tag, $handle) {
    if ($handle === 'voxel-play') {
        return str_replace('<script ', '<script type="module" ', $tag);
    }
    return $tag;
}
add_filter('script_loader_tag', 'voxel_play_module_type', 10, 2);

// Mark the body so we can hide the admin bar over the full-screen app.
function voxel_play_body_class($classes) {
    $classes[] = 'voxel-play-page';
    return $classes;
}
add_filter('body_class', 'voxel_play_body_class');

/* ---------------------------------------------------------------------------
 * Community creations — stored in the WordPress database (custom post type)
 * and exposed via a small REST API the SPA talks to.
 * ------------------------------------------------------------------------- */

// Minimum seconds between auto-generated (ambient) figures, site-wide, so the
// gallery grows steadily without flooding. Override via the filter below.
if (!defined('VOXEL_AUTO_THROTTLE_SECS')) {
    define('VOXEL_AUTO_THROTTLE_SECS', 60000); // ~1 per 1000 minutes
}

/* --- Abuse protection ---------------------------------------------------- */
// The create endpoint is anonymous (no login), so these limit spam, overwrites,
// and oversized/offensive content. Tunable via constants/filters.
if (!defined('VOXEL_RL_WINDOW'))     define('VOXEL_RL_WINDOW', 600);     // 10-min window
if (!defined('VOXEL_RL_MAX_WRITES')) define('VOXEL_RL_MAX_WRITES', 40);  // any write / IP / window
if (!defined('VOXEL_RL_MAX_NEW'))    define('VOXEL_RL_MAX_NEW', 12);     // NEW creations / IP / window

/** A coarse, privacy-preserving per-client key (hashed IP) for rate limiting. */
function voxel_play_client_key() {
    $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '0';
    return substr(md5('voxel|' . $ip), 0, 16);
}

/** Token-bucket-ish counter in a transient. Returns false once over `max`. */
function voxel_play_rate_ok($bucket, $max, $window) {
    $key = 'voxel_rl_' . $bucket;
    $n = (int) get_transient($key);
    if ($n >= $max) return false;
    set_transient($key, $n + 1, $window);
    return true;
}

/** Name must be 1–24 of a safe charset and free of obvious profanity. Mirrors
 *  the client validator (defense in depth — the server never trusts the client). */
function voxel_play_name_ok($name) {
    if (!preg_match('/^[\p{L}\p{N} ._\-]{1,24}$/u', $name)) return false;
    $norm = preg_replace('/[^a-z]/', '', strtolower($name)); // strip leet/spacing
    $bad = array('fuck', 'shit', 'bitch', 'cunt', 'nigger', 'faggot', 'rape', 'nazi', 'whore', 'slut');
    foreach ($bad as $w) {
        if (strpos($norm, $w) !== false) return false;
    }
    return true;
}

function voxel_play_register_cpt() {
    register_post_type('voxel_creation', array(
        'labels'      => array('name' => 'Voxel Creations', 'singular_name' => 'Voxel Creation'),
        'public'      => false,
        'show_ui'     => true,
        'show_in_rest' => false,
        'supports'    => array('title'),
    ));
}
add_action('init', 'voxel_play_register_cpt');

/** Map a WP post → the wire record the SPA expects. */
function voxel_play_record($post_id) {
    return array(
        'id'        => get_post_meta($post_id, '_voxel_id', true),
        'name'      => get_the_title($post_id),
        'author'    => get_post_meta($post_id, '_voxel_author', true),
        'voxBytes'  => get_post_meta($post_id, '_voxel_vox', true),   // base64
        'thumb'     => get_post_meta($post_id, '_voxel_thumb', true), // data URL
        'parentId'  => get_post_meta($post_id, '_voxel_parent', true) ?: null,
        'createdAt' => (int) get_post_meta($post_id, '_voxel_created', true),
        'updatedAt' => (int) get_post_meta($post_id, '_voxel_updated', true),
        'auto'      => (bool) get_post_meta($post_id, '_voxel_auto', true),
    );
}

function voxel_play_find_post($id) {
    $q = get_posts(array(
        'post_type'   => 'voxel_creation',
        'meta_key'    => '_voxel_id',
        'meta_value'  => $id,
        'numberposts' => 1,
        'post_status' => 'publish',
    ));
    return $q ? $q[0]->ID : 0;
}

function voxel_play_rest_routes() {
    register_rest_route('voxel/v1', '/creations', array(
        array('methods' => 'GET',  'callback' => 'voxel_play_list',   'permission_callback' => '__return_true'),
        array('methods' => 'POST', 'callback' => 'voxel_play_create', 'permission_callback' => '__return_true'),
    ));
    register_rest_route('voxel/v1', '/creations/(?P<id>[A-Za-z0-9_-]+)', array(
        array('methods' => 'GET', 'callback' => 'voxel_play_get', 'permission_callback' => '__return_true'),
    ));
}
add_action('rest_api_init', 'voxel_play_rest_routes');

function voxel_play_list() {
    $posts = get_posts(array(
        'post_type'   => 'voxel_creation',
        'numberposts' => 200,
        'orderby'     => 'meta_value_num',
        'meta_key'    => '_voxel_updated',
        'order'       => 'DESC',
        'post_status' => 'publish',
    ));
    $out = array();
    foreach ($posts as $p) {
        $out[] = voxel_play_record($p->ID);
    }
    // Human-made creations first, then auto (seed/ambient); newest-first within each.
    usort($out, function ($a, $b) {
        $ha = !empty($a['auto']) ? 1 : 0;
        $hb = !empty($b['auto']) ? 1 : 0;
        if ($ha !== $hb) return $ha - $hb;
        return $b['updatedAt'] - $a['updatedAt'];
    });
    return rest_ensure_response($out);
}

function voxel_play_get($req) {
    $pid = voxel_play_find_post($req['id']);
    if (!$pid) {
        return new WP_Error('not_found', 'Not found', array('status' => 404));
    }
    return rest_ensure_response(voxel_play_record($pid));
}

function voxel_play_create($req) {
    $b = $req->get_json_params();
    $auto    = !empty($b['auto']);    // invisible sort flag: auto-generated (seed/ambient) vs human
    $ambient = !empty($b['ambient']); // unsolicited page-leave beacon → rate-limited
    $id      = isset($b['id']) ? sanitize_text_field($b['id']) : '';
    $name   = isset($b['name']) ? sanitize_text_field($b['name']) : 'Creation';
    $author = isset($b['author']) ? trim(sanitize_text_field($b['author'])) : '';
    $thumb  = isset($b['thumb']) ? (string) $b['thumb'] : '';
    $vox    = isset($b['voxBytes']) ? (string) $b['voxBytes'] : '';
    $parent = isset($b['parentId']) && $b['parentId'] ? sanitize_text_field($b['parentId']) : '';
    // Per-browser owner token (set client-side, persisted in localStorage). Used
    // to stop one visitor from overwriting another's creation by reusing its id.
    $owner  = isset($b['owner']) ? sanitize_text_field($b['owner']) : '';

    // (1) Per-IP write rate limit — blunt anti-spam/anti-DoS for the whole
    // endpoint. Counts every attempt (including invalid ones).
    $ipkey = voxel_play_client_key();
    if (!voxel_play_rate_ok('w_' . $ipkey, VOXEL_RL_MAX_WRITES, VOXEL_RL_WINDOW)) {
        return new WP_Error('rate_limited', 'Too many requests — please slow down.', array('status' => 429));
    }

    // (2) Shape + content validation (the client validates too).
    if ($id === '' || $vox === '') {
        return new WP_Error('bad_request', 'Missing id or model data', array('status' => 400));
    }
    if (!voxel_play_name_ok($author)) {
        return new WP_Error('bad_name', 'Name must be 1–24 characters and not offensive.', array('status' => 422));
    }
    // vox must look like base64; thumb (if present) must be a data:image URL —
    // prevents javascript:/text payloads being stored and later rendered.
    if (strlen($vox) < 8 || !preg_match('#^[A-Za-z0-9+/=\r\n]+$#', $vox)) {
        return new WP_Error('bad_vox', 'Invalid model data', array('status' => 422));
    }
    if ($thumb !== '' && strpos($thumb, 'data:image/') !== 0) {
        return new WP_Error('bad_thumb', 'Invalid thumbnail', array('status' => 422));
    }
    // Size guards (~2.6MB base64 each) to avoid storage abuse.
    if (strlen($vox) > 2700000 || strlen($thumb) > 2700000) {
        return new WP_Error('too_big', 'Payload too large', array('status' => 413));
    }

    // (3) Site-wide rate limit for ambient (page-leave) figures: if one landed
    // recently, silently no-op (200) so the beacon doesn't error, skip insert.
    if ($ambient) {
        $window = (int) apply_filters('voxel_play_auto_throttle', VOXEL_AUTO_THROTTLE_SECS);
        if (get_transient('voxel_play_last_auto')) {
            return rest_ensure_response(array('throttled' => true));
        }
        set_transient('voxel_play_last_auto', 1, $window);
    }

    $now = (int) round(microtime(true) * 1000);
    $pid = voxel_play_find_post($id);
    if ($pid) {
        // (4) Ownership: only the creator (matching owner token) may update an
        // existing creation — stops id-reuse overwrites (IDOR).
        $existing = get_post_meta($pid, '_voxel_owner', true);
        if ($existing !== '' && $existing !== $owner) {
            return new WP_Error('forbidden', 'You can only edit your own creation.', array('status' => 403));
        }
        wp_update_post(array('ID' => $pid, 'post_title' => $name));
    } else {
        // (5) Stricter per-IP cap on brand-new creations — the core anti-spam
        // protection (someone mass-creating models).
        if (!voxel_play_rate_ok('n_' . $ipkey, VOXEL_RL_MAX_NEW, VOXEL_RL_WINDOW)) {
            return new WP_Error('rate_limited', 'Too many new creations — try again later.', array('status' => 429));
        }
        $pid = wp_insert_post(array(
            'post_type'   => 'voxel_creation',
            'post_status' => 'publish',
            'post_title'  => $name,
        ));
        update_post_meta($pid, '_voxel_id', $id);
        update_post_meta($pid, '_voxel_created', $now);
        update_post_meta($pid, '_voxel_owner', $owner);
    }
    update_post_meta($pid, '_voxel_author', $author);
    update_post_meta($pid, '_voxel_thumb', $thumb);
    update_post_meta($pid, '_voxel_vox', $vox);
    update_post_meta($pid, '_voxel_parent', $parent);
    update_post_meta($pid, '_voxel_updated', $now);
    update_post_meta($pid, '_voxel_auto', $auto ? 1 : 0);

    return rest_ensure_response(voxel_play_record($pid));
}
