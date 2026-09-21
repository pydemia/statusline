from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
settings_js = (root / "shared/settings.js").read_text()
content_js = (root / "content/statusline.js").read_text()
out_dir = root / "tests" / "artifacts"
out_dir.mkdir(exist_ok=True)

mock_js = r'''
(() => {
  const store = { dateTimeFormat: 'YYYY.MM.DD ddd HH:mm:ss', clockTimeZone: 'Asia/Seoul', worldClocks: ['UTC', 'America/New_York'] };
  const storageListeners = [];
  const runtimeListeners = [];
  globalThis.chrome = {
    storage: {
      sync: {
        async get() { return { ...store }; },
        async set(values) {
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: store[key], newValue: value };
            store[key] = value;
          }
          for (const listener of storageListeners) listener(changes, 'sync');
        }
      },
      onChanged: { addListener(fn) { storageListeners.push(fn); } }
    },
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        let response = { ok: true };
        if (message.type === 'GET_ZOOM') response = { ok: true, zoom: 1 };
        if (message.type === 'SET_ZOOM') response = { ok: true, zoom: message.zoom };
        if (message.type === 'LIST_WINDOW_TABS') {
          response = {
            ok: true,
            splitSupported: true,
            tabs: [
              { id: 1, index: 0, title: 'Statusline preview', url: 'https://preview.test/', active: true, pinned: false, groupId: -1, favIconUrl: '' },
              { id: 2, index: 1, title: 'Microsoft Edge extensions', url: 'https://learn.microsoft.com/edge', active: false, pinned: false, groupId: -1, favIconUrl: '' },
              { id: 3, index: 2, title: 'GitHub', url: 'https://github.com/', active: false, pinned: false, groupId: -1, favIconUrl: '' }
            ]
          };
        }
        if (message.type === 'TILE_TABS') response = { ok: true, message: 'Tiled two tabs.' };
        if (message.type === 'STACK_TABS') response = { ok: true, message: 'Stacked tabs.' };
        if (message.type === 'CAPTURE_VISIBLE_TAB') {
          const canvas = document.createElement('canvas');
          canvas.width = innerWidth;
          canvas.height = innerHeight;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#f0f0f0';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#222';
          ctx.fillText(`capture-${scrollY}`, 20, 30);
          response = { ok: true, dataUrl: canvas.toDataURL('image/png'), filename: 'test.png', message: 'Captured.' };
        }
        if (message.type === 'OPEN_TAB') response = { ok: true };
        if (message.type === 'OPEN_SHORTCUT_WINDOW') response = { ok: true, reused: false, windowId: 55 };
        queueMicrotask(() => callback?.(response));
      },
      onMessage: { addListener(fn) { runtimeListeners.push(fn); } },
      openOptionsPage() {},
      getURL(path) { return `chrome-extension://test/${path}`; }
    }
  };
})();
'''

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        executable_path="/usr/bin/chromium",
        args=["--no-sandbox"],
    )
    page = browser.new_page(viewport={"width": 2048, "height": 900})
    page.set_content(
        '''<!doctype html><html><head><title>Statusline preview</title><style>
        body{margin:0;min-height:2600px;font-family:Arial,sans-serif;background:#f7f7f7;color:#222}
        main{max-width:900px;margin:70px auto;padding:40px;background:white;border:1px solid #ddd}
        h1{font-size:44px;margin:0 0 16px} p{font-size:18px;line-height:1.7}
        .nested-scroll{height:180px;overflow:auto;border:1px solid #ccc;padding:10px}
        .nested-scroll>div{height:1000px;background:linear-gradient(#fff,#ddd)}
        </style></head><body><main><h1>Statusline runtime preview</h1>
        <p>Mock page used to validate the injected status bar and floating controls.</p>
        <p><a href="https://example.com/target">Hover link target</a></p>
        <div class="nested-scroll"><div>Nested scrolling content</div></div>
        </main></body></html>'''
    )
    page.evaluate(
        """() => {
          const sink = document.createElement('input');
          sink.id = 'page-key-sink';
          sink.setAttribute('aria-label', 'Host page key sink');
          sink.style.position = 'fixed';
          sink.style.left = '-9999px';
          sink.style.top = '0';
          document.body.append(sink);
          document.addEventListener('keydown', (event) => {
            if (event.key.length === 1) sink.focus();
          });
        }"""
    )
    page.add_script_tag(content=mock_js)
    page.add_script_tag(content=settings_js)
    page.add_script_tag(content=content_js)
    page.wait_for_timeout(250)

    host = page.locator("#__statusline_extension_host__")
    assert host.count() == 1
    assert page.locator(".bar").count() == 1
    assert host.evaluate("el => el.parentElement === document.documentElement")
    initial_bar_rect = page.locator(".bar").bounding_box()
    assert initial_bar_rect
    assert page.locator("#__statusline_extension_host__").get_attribute(
        "data-statusline-dock-profile"
    ).startswith("document:")
    assert page.locator("body").evaluate(
        "el => getComputedStyle(el).paddingBottom === '36px'"
    )
    assert page.locator("body").evaluate(
        "el => el.style.transform === '' && document.documentElement.style.overflow === ''"
    )

    scroll = page.locator('[data-widget="scroll"]')
    assert scroll.count() == 1
    assert "%" not in scroll.inner_text()

    panel_dock = page.locator('.zone-left > [data-widget="panels"]')
    assert panel_dock.count() == 1
    assert page.locator('.zone-left > .widget').count() == 1
    assert panel_dock.locator(".panel-launcher").last.get_attribute("data-panel-manage") == "true"

    assert page.locator('.zone-center').count() == 0
    assert page.locator('[data-widget="host"]').count() == 0
    assert page.locator('.address-input').count() == 0
    assert page.locator('.zone-right > [data-widget="panels"]').count() == 0
    assert page.locator('.zone-right > [data-widget="capture"]').count() == 1
    assert page.locator('.zone-right > [data-widget="clock"]').count() == 1

    # Narrow windows should prioritize action/status controls now that the address field is removed.
    page.set_viewport_size({"width": 720, "height": 720})
    page.wait_for_timeout(120)
    for widget_id in ["capture", "devtools", "tile", "stack", "zoom", "clock"]:
        rect = page.locator(f'[data-widget="{widget_id}"]').bounding_box()
        assert rect and rect["x"] + rect["width"] <= 720
        assert rect["x"] >= 0
    page.set_viewport_size({"width": 1280, "height": 800})
    page.wait_for_timeout(120)
    assert page.locator('[data-widget="title"]').count() == 0
    assert page.locator('[data-widget="load"]').count() == 0
    assert page.locator('.bar').evaluate(
        "el => getComputedStyle(el).paddingLeft === '14px' && getComputedStyle(el).paddingRight === '14px'"
    )
    assert page.locator('.zone-right > .widget').first.evaluate(
        "el => getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)'"
    )

    clock_button = page.locator('[data-widget="clock"]')
    clock_button.click()
    page.wait_for_timeout(100)
    assert page.locator('.clock-surface').count() == 1
    clock_rect = clock_button.bounding_box()
    clock_surface_rect = page.locator('.clock-surface').bounding_box()
    assert clock_rect and clock_surface_rect
    assert clock_surface_rect["y"] + clock_surface_rect["height"] <= clock_rect["y"] - 6
    assert page.locator('.clock-primary > .analog-clock').count() == 1
    assert page.locator('.clock-field input[aria-label="Date and time format"]').input_value() == 'YYYY.MM.DD ddd HH:mm:ss'
    assert page.locator('.clock-field input[aria-label="Primary clock time zone"]').input_value() == 'Asia/Seoul'
    assert page.locator('.world-clock-row').count() == 2
    first_world_row = page.locator('.world-clock-row').first
    assert first_world_row.locator(':scope > .analog-clock').count() == 1
    assert first_world_row.locator(':scope > .analog-clock').evaluate('(el) => el === el.parentElement.firstElementChild')
    page.screenshot(path=str(out_dir / 'clock-panel.png'), full_page=False)

    world_input = page.locator('input[aria-label="World clock time zone"]')
    world_input.fill('Europe/London')
    page.locator('.world-clock-add button[type="submit"]').click()
    page.wait_for_timeout(150)
    assert page.locator('.clock-surface').count() == 1
    assert page.locator('.world-clock-row').count() == 3
    assert page.locator('.world-clock-row[data-time-zone="Europe/London"]').count() == 1

    format_input = page.locator('input[aria-label="Date and time format"]')
    zone_input = page.locator('input[aria-label="Primary clock time zone"]')
    format_input.fill('HH:mm')
    zone_input.fill('Asia/Tokyo')
    page.get_by_text('Apply', exact=True).click()
    page.wait_for_timeout(150)
    assert page.locator('.clock-surface').count() == 1
    assert page.locator('input[aria-label="Date and time format"]').input_value() == 'HH:mm'
    assert page.locator('input[aria-label="Primary clock time zone"]').input_value() == 'Asia/Tokyo'
    page.locator('.surface-icon-button[aria-label="Close"]').click()

    page.screenshot(path=str(out_dir / "statusline-v0.9.png"), full_page=False)

    zoom = page.locator('[data-widget="zoom"] .zoom-value')
    zoom.click()
    zoom.fill("125")
    zoom.press("Enter")
    page.wait_for_timeout(50)
    assert zoom.input_value() == "125%"

    thumb = page.locator('[data-widget="scroll"] .scroll-thumb')
    before_scroll = thumb.get_attribute("style") or ""
    page.eval_on_selector(
        ".nested-scroll",
        "el => { el.scrollTop = 500; el.dispatchEvent(new Event('scroll', {bubbles:false})); }",
    )
    page.wait_for_timeout(80)
    after_scroll = thumb.get_attribute("style") or ""
    assert after_scroll != before_scroll
    assert "Scroll position:" in scroll.get_attribute("title")

    capture_button = page.locator('[data-widget="capture"]')
    capture_button.click()
    page.wait_for_timeout(80)
    assert page.locator(".capture-option").count() == 4
    capture_rect = capture_button.bounding_box()
    capture_surface_rect = page.locator(".capture-surface").bounding_box()
    assert capture_rect and capture_surface_rect
    capture_center = capture_rect["x"] + capture_rect["width"] / 2
    surface_center = capture_surface_rect["x"] + capture_surface_rect["width"] / 2
    assert abs(capture_center - surface_center) < 3
    assert capture_surface_rect["y"] + capture_surface_rect["height"] <= capture_rect["y"] - 6
    page.screenshot(path=str(out_dir / "capture-menu.png"), full_page=False)

    with page.expect_download(timeout=5000) as visible_download:
        page.get_by_text("Visible area", exact=True).click()
    assert visible_download.value.suggested_filename.startswith("statusline-visible-")

    page.locator('[data-widget="capture"]').click()
    page.get_by_text("Select area", exact=True).click()
    page.wait_for_timeout(50)
    assert page.locator(".capture-selection-overlay").count() == 1
    with page.expect_download(timeout=5000) as selection_download:
        page.mouse.move(300, 240)
        page.mouse.down()
        page.mouse.move(650, 460, steps=3)
        page.mouse.up()
    assert selection_download.value.suggested_filename.startswith("statusline-selection-")

    page.locator('[data-widget="capture"]').click()
    page.get_by_text("Scroll down", exact=True).click()
    page.wait_for_timeout(50)
    with page.expect_download(timeout=15000) as scroll_download:
        page.mouse.move(320, 300)
        page.mouse.down()
        page.mouse.move(720, 430, steps=3)
        page.mouse.up()
    assert scroll_download.value.suggested_filename.startswith("statusline-scroll-")

    page.locator('[data-widget="capture"]').click()
    with page.expect_download(timeout=7000) as full_download:
        page.get_by_text("Full page", exact=True).click()
    assert full_download.value.suggested_filename.startswith("statusline-full-")

    page.locator('[data-panel-manage="true"]').click()
    page.wait_for_timeout(100)
    assert page.locator(".floating-surface").count() == 1
    assert page.locator(".floating-title").inner_text() == "Shortcuts"
    page.screenshot(path=str(out_dir / "shortcut-manager.png"), full_page=False)

    shortcut_name = page.locator('input[aria-label="Shortcut name"]')
    shortcut_url = page.locator('input[aria-label="Shortcut URL"]')
    shortcut_name.click()
    page.keyboard.type("Exam")
    assert shortcut_name.input_value() == "Exam"
    assert shortcut_name.evaluate("el => el.getRootNode().activeElement === el")
    assert not page.locator("#page-key-sink").evaluate("el => document.activeElement === el")

    # A storage update rerenders Statusline; the shortcut form must preserve its
    # draft, focus, and caret rather than moving the cursor back to the page.
    page.evaluate("chrome.storage.sync.set({opacity: 0.96})")
    page.wait_for_timeout(120)
    shortcut_name = page.locator('input[aria-label="Shortcut name"]')
    shortcut_url = page.locator('input[aria-label="Shortcut URL"]')
    assert shortcut_name.input_value() == "Exam"
    assert shortcut_name.evaluate("el => el.getRootNode().activeElement === el")
    page.keyboard.type("ple")
    assert shortcut_name.input_value() == "Example"

    shortcut_url.click()
    page.keyboard.type("https://example.com")
    assert shortcut_url.input_value() == "https://example.com"
    page.locator('.panel-form button[type="submit"]').click()
    page.wait_for_timeout(120)
    assert page.locator(".panel-manager-row").count() == 1
    assert page.locator('.panel-launcher[data-panel-id]').count() == 1
    assert page.locator('[data-widget="panels"] .panel-launcher').last.get_attribute("data-panel-manage") == "true"

    # Add a second shortcut, then verify click-and-drag ordering from the dock.
    page.locator('input[aria-label="Shortcut name"]').fill("Docs")
    page.locator('input[aria-label="Shortcut URL"]').fill("https://example.com/docs")
    page.locator('.panel-form button[type="submit"]').click()
    page.wait_for_timeout(120)
    assert page.locator(".panel-manager-row").count() == 2
    page.locator('.surface-icon-button[aria-label="Close"]').click()

    example_button = page.locator('.panel-launcher[data-panel-id][title^="Example"]')
    docs_button = page.locator('.panel-launcher[data-panel-id][title^="Docs"]')
    docs_button.drag_to(example_button)
    page.wait_for_timeout(160)
    ordered_titles = page.locator('.panel-launcher[data-panel-id]').evaluate_all(
        "els => els.map(el => el.title)"
    )
    assert ordered_titles[0].startswith("Docs")
    assert ordered_titles[1].startswith("Example")
    assert page.locator('[data-widget="panels"] .panel-launcher').last.get_attribute("data-panel-manage") == "true"

    page.locator('.panel-launcher[data-panel-id][title^="Example"]').click()
    page.wait_for_timeout(100)
    assert page.locator(".web-panel-frame").count() == 0
    assert page.locator(".floating-title").filter(has_text="Example").count() == 0

    tile_button = page.locator('[data-widget="tile"]')
    tile_button.click()
    page.wait_for_timeout(100)
    assert page.locator(".tab-picker").count() == 1
    tile_rect = tile_button.bounding_box()
    tile_surface_rect = page.locator(".floating-surface").bounding_box()
    assert tile_rect and tile_surface_rect
    tile_center = tile_rect["x"] + tile_rect["width"] / 2
    tile_surface_center = tile_surface_rect["x"] + tile_surface_rect["width"] / 2
    assert abs(tile_center - tile_surface_center) < 3
    assert tile_surface_rect["y"] + tile_surface_rect["height"] <= tile_rect["y"] - 6
    assert page.locator(".tab-row").count() == 3
    page.locator(".tab-row input").nth(1).check()
    assert page.locator(".tab-picker-footer button").is_enabled()
    page.screenshot(path=str(out_dir / "tab-picker.png"), full_page=False)
    page.keyboard.press("Escape")
    page.wait_for_timeout(50)

    # Regression: app shells can remove extension-owned direct children during
    # client-side rerenders. Statusline must remount the same host automatically.
    assert host.evaluate("el => el.parentElement === document.documentElement")
    page.evaluate("document.getElementById('__statusline_extension_host__').remove()")
    page.wait_for_timeout(100)
    assert page.locator("#__statusline_extension_host__").count() == 1
    assert page.locator(".bar").count() == 1
    assert page.locator("#__statusline_extension_host__").evaluate(
        "el => el.parentElement === document.documentElement"
    )

    # Regression: replacing <body> must also reattach Statusline to the new body.
    page.evaluate(
        """() => {
          const nextBody = document.createElement('body');
          nextBody.style.cssText = 'margin:0;height:100vh;min-height:100vh;overflow:hidden';
          nextBody.innerHTML = '<div id=\"replacement-shell\" style=\"margin:0;padding:0;width:100%;height:100vh;min-height:100vh;overflow:auto\">Replacement app shell<div id=\"fixed-composer\" style=\"position:fixed;left:20%;right:20%;bottom:0;height:72px;background:#fff;border:1px solid #ccc\">Composer</div></div><div id=\"portal-fixed\" style=\"position:fixed;left:70%;right:2%;bottom:0;height:52px;background:#eef;border:1px solid #99a\">Portal control</div>';
          document.body.replaceWith(nextBody);
        }"""
    )
    page.wait_for_timeout(120)
    assert page.locator("#__statusline_extension_host__").count() == 1
    assert page.locator(".bar").count() == 1
    assert page.locator("#__statusline_extension_host__").evaluate(
        "el => el.parentElement === document.documentElement"
    )
    # Docked mode must reserve a separate strip on full-height SPA shells.
    shell_rect = page.locator("#replacement-shell").bounding_box()
    bar_rect = page.locator(".bar").bounding_box()
    assert shell_rect and bar_rect
    assert shell_rect["y"] + shell_rect["height"] <= bar_rect["y"] + 1
    assert page.locator("body").evaluate(
        "el => getComputedStyle(el).transform === 'none'"
    )
    assert page.locator("#__statusline_extension_host__").get_attribute(
        "data-statusline-dock-profile"
    ).startswith("app:")
    # A viewport-fixed composer inside the SPA shell must also stay above the
    # docked Statusline. Shrinking the shell alone is insufficient unless the
    # shell becomes the containing block for fixed descendants.
    composer_rect = page.locator("#fixed-composer").bounding_box()
    bar_rect = page.locator(".bar").bounding_box()
    assert composer_rect and bar_rect
    assert composer_rect["y"] + composer_rect["height"] <= bar_rect["y"] + 1
    # Fixed portal controls mounted outside the primary app shell must also be
    # inset when they occupy the docked edge.
    portal_rect = page.locator("#portal-fixed").bounding_box()
    assert portal_rect and bar_rect
    assert portal_rect["y"] + portal_rect["height"] <= bar_rect["y"] + 1
    page.screenshot(path=str(out_dir / "docked-fixed-app.png"), full_page=False)

    # Regression: Document-scroll layouts use sticky headers, fixed drawers,
    # and wrapper min-heights. Safe dock must not rewrite
    # html/body viewport geometry or move Moodle-owned fixed UI.
    learnus = browser.new_page(viewport={"width": 1600, "height": 900})
    learnus_html = '''<!doctype html><html><head><title>Document scroll mock</title><style>
      html{margin:0;padding:0}
      body{margin:0;padding:0 0 20px;min-height:1900px;font-family:Arial,sans-serif;box-sizing:border-box}
      #navbar{position:sticky;top:0;height:64px;background:#17345b;color:#fff;z-index:20}
      #page-wrapper{min-height:100vh;display:flex;align-items:stretch;background:#f5f6f8}
      #drawer{position:fixed;top:64px;bottom:0;left:0;width:260px;background:#fff;border-right:1px solid #ddd}
      #page{margin-left:260px;width:calc(100% - 260px);min-height:1500px;padding:28px;box-sizing:border-box}
      #page-footer{height:180px;background:#eee}
    </style></head><body><div id="navbar">Document layout</div><div id="page-wrapper"><aside id="drawer">Drawer</aside><main id="page">Course content</main></div><footer id="page-footer">Footer</footer></body></html>'''
    learnus.set_content(learnus_html)
    before_drawer = learnus.locator("#drawer").bounding_box()
    before_wrapper = learnus.locator("#page-wrapper").bounding_box()
    before_document_height = learnus.evaluate("document.scrollingElement.scrollHeight")
    learnus.add_script_tag(content=mock_js)
    learnus.add_script_tag(content=settings_js)
    learnus.add_script_tag(content=content_js)
    learnus.wait_for_timeout(180)
    learnus_host = learnus.locator("#__statusline_extension_host__")
    assert learnus_host.count() == 1
    assert learnus_host.get_attribute("data-statusline-dock-profile") == "document:document-scroll"
    assert learnus.locator("html").evaluate(
        "el => el.style.height === '' && el.style.overflow === '' && el.style.transform === ''"
    )
    assert learnus.locator("body").evaluate(
        "el => el.style.height === '' && el.style.overflow === '' && el.style.transform === ''"
    )
    assert learnus.locator("body").evaluate(
        "el => getComputedStyle(el).paddingBottom === '36px'"
    )
    after_document_height = learnus.evaluate("document.scrollingElement.scrollHeight")
    # Existing bottom spacing must be reused instead of adding a full second
    # Statusline-height tail to the document scroll range.
    assert after_document_height - before_document_height <= 17
    after_drawer = learnus.locator("#drawer").bounding_box()
    after_wrapper = learnus.locator("#page-wrapper").bounding_box()
    assert before_drawer and after_drawer and before_wrapper and after_wrapper
    assert abs(before_drawer["x"] - after_drawer["x"]) < 1
    assert abs(before_drawer["y"] - after_drawer["y"]) < 1
    learnus_bar = learnus.locator(".bar").bounding_box()
    assert learnus_bar
    assert after_drawer["y"] + after_drawer["height"] <= learnus_bar["y"] + 1
    assert abs(before_wrapper["x"] - after_wrapper["x"]) < 1
    assert abs(before_wrapper["width"] - after_wrapper["width"]) < 1
    learnus.screenshot(path=str(out_dir / "document-safe-dock.png"), full_page=False)

    # Regression: simple document pages with existing bottom spacing must not
    # gain a second full Statusline-height scroll tail. At maximum scroll the
    # last flow content should stop immediately above Statusline.
    simple_doc = browser.new_page(viewport={"width": 1400, "height": 800})
    simple_doc.set_content('''<!doctype html><html><head><style>
      html,body{margin:0}
      body{padding-bottom:24px;font-family:Arial,sans-serif}
      #content{height:1500px;background:linear-gradient(#fff,#eee)}
      #last{height:80px;background:#dfe8f6}
    </style></head><body><main id="content"></main><footer id="last">End</footer></body></html>''')
    simple_before_height = simple_doc.evaluate("document.scrollingElement.scrollHeight")
    simple_doc.add_script_tag(content=mock_js)
    simple_doc.add_script_tag(content=settings_js)
    simple_doc.add_script_tag(content=content_js)
    simple_doc.wait_for_timeout(180)
    simple_after_height = simple_doc.evaluate("document.scrollingElement.scrollHeight")
    assert simple_doc.locator("body").evaluate(
        "el => getComputedStyle(el).paddingBottom === '36px'"
    )
    assert simple_after_height - simple_before_height <= 13
    simple_doc.evaluate("window.scrollTo(0, document.scrollingElement.scrollHeight)")
    simple_doc.wait_for_timeout(80)
    simple_bar = simple_doc.locator(".bar").bounding_box()
    simple_last = simple_doc.locator("#last").bounding_box()
    assert simple_bar and simple_last
    assert abs((simple_last["y"] + simple_last["height"]) - simple_bar["y"]) <= 1
    simple_doc.screenshot(path=str(out_dir / "simple-document-bottom.png"), full_page=False)

    # Regression: Viewport applications keep html/body ownership while the detected app
    # shell and bottom-fixed controls stop above Statusline.
    chatgpt = browser.new_page(viewport={"width": 1600, "height": 900})
    chatgpt_html = '''<!doctype html><html><head><title>Viewport app mock</title><style>
      html,body{margin:0;width:100%;height:100%;overflow:hidden}
      #app{height:100vh;min-height:100vh;display:flex;flex-direction:column;background:#fff}
      #header{height:56px;flex:none;border-bottom:1px solid #ddd}
      #conversation{flex:1;overflow:auto;padding:24px 24px 140px;box-sizing:border-box}
      #composer{position:fixed;left:22%;right:22%;bottom:0;height:78px;background:#fff;border:1px solid #ccc;border-radius:18px}
      #portal{position:fixed;right:18px;bottom:0;width:220px;height:46px;background:#eef;border:1px solid #99a}
    </style></head><body><div id="app"><div id="header">Viewport app</div><main id="conversation">Conversation</main><div id="composer">Composer</div></div><div id="portal">Portal control</div></body></html>'''
    chatgpt.set_content(chatgpt_html)
    chatgpt.add_script_tag(content=mock_js)
    chatgpt.add_script_tag(content=settings_js)
    chatgpt.add_script_tag(content=content_js)
    chatgpt.wait_for_timeout(180)
    chat_host = chatgpt.locator("#__statusline_extension_host__")
    assert chat_host.get_attribute("data-statusline-dock-profile") == "app:locked-viewport"
    assert chatgpt.locator("html").evaluate(
        "el => el.style.height === '' && el.style.overflow === '' && el.style.transform === ''"
    )
    assert chatgpt.locator("body").evaluate(
        "el => el.style.height === '' && el.style.overflow === '' && el.style.transform === ''"
    )
    chat_bar = chatgpt.locator(".bar").bounding_box()
    chat_app = chatgpt.locator("#app").bounding_box()
    chat_composer = chatgpt.locator("#composer").bounding_box()
    chat_portal = chatgpt.locator("#portal").bounding_box()
    assert chat_bar and chat_app and chat_composer and chat_portal
    assert chat_app["y"] + chat_app["height"] <= chat_bar["y"] + 1
    assert chat_composer["y"] + chat_composer["height"] <= chat_bar["y"] + 1
    assert chat_portal["y"] + chat_portal["height"] <= chat_bar["y"] + 1
    chatgpt.screenshot(path=str(out_dir / "viewport-app-safe-dock.png"), full_page=False)

    # Regression: application shells may be nested several levels below body,
    # and bottom controls can sit slightly above the physical viewport edge.
    deep_app = browser.new_page(viewport={"width": 1600, "height": 900})
    deep_app_html = '''<!doctype html><html><head><title>Deep viewport app</title><style>
      html,body{margin:0;width:100%;height:100%;overflow:hidden}
      #bootstrap{width:100%;height:100%}
      #frame{width:100%;height:100%;display:flex}
      #shell{width:100%;height:100vh;min-height:100vh;display:grid;grid-template-rows:56px 1fr;background:#fff}
      #content{overflow:auto;padding:24px 24px 150px;box-sizing:border-box}
      #composer{position:fixed;left:25%;right:25%;bottom:14px;height:82px;background:#fff;border:1px solid #bbb;border-radius:20px}
      #portal-root{position:fixed;inset:0;pointer-events:none;display:flex;align-items:flex-end;justify-content:flex-end}
      #portal-action{pointer-events:auto;width:240px;height:48px;margin:0 18px 12px 0;background:#eef;border:1px solid #99a}
    </style></head><body><div id="bootstrap"><div id="frame"><section id="shell"><header>App</header><main id="content"><div style="height:1800px">Scrollable application content</div></main><div id="composer">Composer</div></section></div></div><div id="portal-root"><div id="portal-action">Portal action</div></div></body></html>'''
    deep_app.set_content(deep_app_html)
    deep_app.add_script_tag(content=mock_js)
    deep_app.add_script_tag(content=settings_js)
    deep_app.add_script_tag(content=content_js)
    deep_app.wait_for_timeout(240)
    deep_host = deep_app.locator("#__statusline_extension_host__")
    assert deep_host.get_attribute("data-statusline-dock-profile").startswith("app:")
    deep_bar = deep_app.locator(".bar").bounding_box()
    deep_composer = deep_app.locator("#composer").bounding_box()
    deep_portal = deep_app.locator("#portal-action").bounding_box()
    assert deep_bar and deep_composer and deep_portal
    assert deep_composer["y"] + deep_composer["height"] <= deep_bar["y"] + 1
    assert deep_portal["y"] + deep_portal["height"] <= deep_bar["y"] + 1
    assert deep_app.locator("html").evaluate(
        "el => el.style.height === '' && el.style.overflow === '' && el.style.transform === ''"
    )
    assert deep_app.locator("body").evaluate(
        "el => el.style.height === '' && el.style.overflow === '' && el.style.transform === ''"
    )
    deep_app.screenshot(path=str(out_dir / "deep-viewport-app-safe-dock.png"), full_page=False)


    # Regression: multi-surface applications can combine a primary conversation
    # viewport with a separately portal-mounted side panel. Docking must map
    # both surfaces to the same reduced viewport without double-offsetting the
    # main composer or leaving the side panel behind Statusline.
    split_app = browser.new_page(viewport={"width": 1600, "height": 900})
    split_app_html = '''<!doctype html><html><head><title>Split viewport app</title><style>
      html,body{margin:0;width:100%;height:100%;overflow:hidden}
      #workspace{position:relative;width:100%;height:100vh;display:flex;background:#fff}
      #left-snb{position:absolute;left:0;top:0;width:240px;height:100vh;background:#f1f1f1;border-right:1px solid #ccc;z-index:3}
      #main{position:relative;margin-left:240px;width:calc(72% - 240px);height:100%;display:flex;flex-direction:column}
      #thread{flex:1;overflow:auto;padding:24px 24px 160px;box-sizing:border-box}
      #main-composer{position:fixed;left:18%;right:36%;bottom:14px;height:82px;background:#fff;border:1px solid #bbb;border-radius:20px}
      #side-portal{position:fixed;top:0;right:0;bottom:0;width:420px;background:#f5f5f5;border-left:1px solid #ccc}
      #side-panel{position:absolute;inset:0;overflow:auto;padding-bottom:90px;box-sizing:border-box}
      #side-footer{position:absolute;left:0;right:0;bottom:0;height:64px;background:#eee;border-top:1px solid #ccc}
    </style></head><body><div id="workspace"><nav id="left-snb">Side navigation</nav><main id="main"><div id="thread"><div style="height:1600px">Main thread</div></div><div id="main-composer">Composer</div></main></div><aside id="side-portal"><div id="side-panel">Side panel<div id="side-footer">Side footer</div></div></aside></body></html>'''
    split_app.set_content(split_app_html)
    split_app.add_script_tag(content=mock_js)
    split_app.add_script_tag(content=settings_js)
    split_app.add_script_tag(content=content_js)
    split_app.wait_for_timeout(240)
    split_bar = split_app.locator(".bar").bounding_box()
    split_composer = split_app.locator("#main-composer").bounding_box()
    split_side_root = split_app.locator("#side-portal").bounding_box()
    split_side_footer = split_app.locator("#side-footer").bounding_box()
    split_snb = split_app.locator("#left-snb").bounding_box()
    assert split_bar and split_composer and split_side_root and split_side_footer and split_snb
    assert split_composer["y"] + split_composer["height"] <= split_bar["y"] - 10
    assert split_composer["y"] + split_composer["height"] >= split_bar["y"] - 18
    assert split_side_root["y"] + split_side_root["height"] <= split_bar["y"] + 1
    assert split_side_footer["y"] + split_side_footer["height"] <= split_bar["y"] + 1
    # Full-height side-navigation rails can be absolute/relative children of
    # the app shell rather than fixed portals. They must share the same dock
    # boundary without a hostname-specific adapter.
    assert split_snb["y"] + split_snb["height"] <= split_bar["y"] + 1
    split_app.screenshot(path=str(out_dir / "split-viewport-safe-dock.png"), full_page=False)

    browser.close()

print("Statusline runtime render test passed.")
