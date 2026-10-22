"""
tray.py — Build H (mockup R34): NeuroVault in the notification area while a sticky is popped out.

Closing NeuroVault's window with a sticky (or the timer) popped out keeps NeuroVault running here, so the
popped-out windows stay (the chosen design). Its menu: Open NeuroVault, Bring them back into NeuroVault, and
Quit NeuroVault (which saves, then closes everything).

Optional: needs the `pystray` package (and Pillow, which it uses for the icon). Without it, closing
NeuroVault closes the popped-out windows too (popout.PopOuts.close_main).
"""
import logging
import threading

log = logging.getLogger(__name__)


def available():
    try:
        import pystray  # noqa: F401
        from PIL import Image  # noqa: F401
        return True
    except Exception:
        return False


def _icon_image(size=64):
    """A plain book outline, like the app's notes icon (wireframe, no emoji), in the default violet."""
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s, w = size / 24, max(2, round(size / 12))
    violet = (162, 155, 254, 255)
    d.rounded_rectangle([3 * s, 2 * s, 20 * s, 22 * s], radius=3 * s, outline=violet, width=w)
    d.line([7 * s, 2 * s, 7 * s, 22 * s], fill=violet, width=w)
    d.line([10 * s, 8 * s, 16 * s, 8 * s], fill=violet, width=w)
    d.line([10 * s, 12 * s, 16 * s, 12 * s], fill=violet, width=w)
    return img


class Tray:
    def __init__(self, pops):
        self.pops = pops
        self.icon = None

    def start(self):
        import pystray
        item, menu = pystray.MenuItem, pystray.Menu
        self.icon = pystray.Icon(
            "NeuroVault", _icon_image(), "NeuroVault · popped-out windows stay on your desktop",
            menu=menu(item("Open NeuroVault", lambda: self.pops.show_main(), default=True),
                      item("Bring them back into NeuroVault", lambda: self.pops.all_in()),
                      menu.SEPARATOR,
                      item("Quit NeuroVault", lambda: self.pops.quit())))
        threading.Thread(target=self._run, daemon=True, name="nv-tray").start()

    def _run(self):
        try:
            self.icon.run()
        except Exception:
            log.exception("the tray icon stopped")

    def stop(self):
        if self.icon is not None:
            try:
                self.icon.stop()
            except Exception:
                log.exception("stopping the tray icon failed")
            self.icon = None
