# Morphizer

Real-time video synth that captures the page via `getDisplayMedia` and runs it through a GPU-accelerated WebGL feedback loop. No dependencies.

## Effects

- **Displacement** — wave, ripple, melt, tunnel, vortex
- **Feedback** — mix, zoom, and rotation per frame for infinite trails
- **Color** — hue shift, saturation, chromatic aberration, brightness
- **Visual** — kaleidoscope, pixelation, scanlines

All parameters are controllable in real time via the plugin panel.

## Enabling

Load after the main DOM-Tools script:

```html
<script src="dom-tools.js"></script>
<script src="plugins/morphizer/morphizer.js"></script>
```

Then toggle it on in DOM-Tools settings (gear icon). The browser will prompt for screen-capture permission on first use.
