<?php
/**
 * Voxel Play — full-page single-page app. Renders the same DOM the standalone
 * app expects (#app > #stage > canvas + #ui, then #gallery-mount). The enqueued
 * bundle (functions.php) boots the App against these elements.
 */
if (!defined('ABSPATH')) {
    exit;
}
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo('charset'); ?>" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
    <div id="app" class="mode-home">
        <div id="stage" class="stage">
            <canvas id="viewport"></canvas>
            <div id="ui"></div>
        </div>
        <div id="gallery-mount"></div>
    </div>
    <?php wp_footer(); ?>
</body>
</html>
