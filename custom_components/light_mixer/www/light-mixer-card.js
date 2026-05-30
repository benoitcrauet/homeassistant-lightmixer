'use strict';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function kelvinToRgb(kelvin) {
  const temp = kelvin / 100;
  let r, g, b;
  if (temp <= 66) {
    r = 255;
    g = Math.max(0, Math.min(255, 99.4708025861 * Math.log(temp) - 161.1195681661));
  } else {
    r = Math.max(0, Math.min(255, 329.698727446 * Math.pow(temp - 60, -0.1332047592)));
    g = Math.max(0, Math.min(255, 288.1221695283 * Math.pow(temp - 60, -0.0755148492)));
  }
  b = temp >= 66 ? 255 : temp <= 19 ? 0
    : Math.max(0, Math.min(255, 138.5177312231 * Math.log(temp - 10) - 305.0447927307));
  return [Math.round(r), Math.round(g), Math.round(b)];
}

function stateToColor(state) {
  if (!state || state.state !== 'on') return null;
  const a = state.attributes;
  if (a.color_mode === 'color_temp' && a.color_temp_kelvin) {
    const [r, g, b] = kelvinToRgb(a.color_temp_kelvin);
    return `rgb(${r},${g},${b})`;
  }
  if (a.rgb_color) return `rgb(${a.rgb_color.join(',')})`;
  return 'rgb(255, 200, 100)';
}

function colorToRgba(color, alpha) {
  const a = Math.max(0, Math.min(1, alpha)).toFixed(2);
  if (!color) return `rgba(255,200,100,${a})`;
  return color.replace(/^rgb\(/, 'rgba(').replace(/\)$/, `,${a})`);
}

// Returns { stroke, filter } for an SVG path based on layer state + tally.
// Non-tally paths stay dark; tally paths glow with a brightness-scaled drop-shadow.
function pathStyle(state, isTally) {
  const DIM = '#2a2a2a';
  const isOn = state?.state === 'on';
  if (!isTally || !isOn) return { stroke: isTally ? '#000' : DIM, filter: 'none' };
  const br  = (state?.attributes?.brightness ?? 255) / 255;
  const col = stateToColor(state) || 'rgb(255,200,100)';
  const m   = col.match(/\d+/g).map(Number);
  // Dim the stroke colour proportionally to brightness so the path itself doesn't overpower the glow
  const dimmed = `rgb(${Math.round(m[0]*br)},${Math.round(m[1]*br)},${Math.round(m[2]*br)})`;
  const filter = br > 0.01
    ? `drop-shadow(0 0 ${(br * 14).toFixed(1)}px ${colorToRgba(col, br * 0.95)}) drop-shadow(0 0 ${(br * 5).toFixed(1)}px ${colorToRgba(col, br * 0.8)})`
    : 'none';
  return { stroke: dimmed, filter };
}

const MODE_LABELS = {
  mix:      'Mix',
  last_set: 'Last set',
  priority: 'Priority',
  layer1:   'Layer 1 only',
  layer2:   'Layer 2 only',
  layer3:   'Layer 3 only',
  off:      'Off',
};

// ─── Card ─────────────────────────────────────────────────────────────────────

class LightMixerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._ents = {};
    this._rendered = false;
  }

  static getConfigElement() {
    return document.createElement('light-mixer-card-editor');
  }

  static getStubConfig() {
    return {
      device_id: '',
      layout: 'vertical',
      show_weights: true,
      show_mode: true,
      show_priority: true,
      show_tally: true,
      show_reset: true,
      clickable_inputs: true,
      clickable_output: true,
    };
  }

  setConfig(config) {
    if (!config.device_id) throw new Error('light-mixer-card: device_id is required');
    this._config = {
      layout: 'vertical',
      show_weights: true,
      show_mode: true,
      show_priority: true,
      show_tally: true,
      show_reset: true,
      clickable_inputs: true,
      clickable_output: true,
      ...config,
    };
    this._rendered = false;
  }

  set hass(hass) {
    this._hass = hass;
    this._discoverEntities();
    if (!this._rendered) {
      this._build();
      this._rendered = true;
    }
    this._update();
  }

  _discoverEntities() {
    const deviceId = this._config.device_id;
    const ents = {};
    if (!this._hass.entities || !deviceId) return;
    for (const [entityId, entry] of Object.entries(this._hass.entities)) {
      if (entry.device_id !== deviceId) continue;
      const local = entityId.split('.')[1] || '';
      if      (entityId.startsWith('light.')         && local.endsWith('_layer1'))          ents.layer1 = entityId;
      else if (entityId.startsWith('light.')         && local.endsWith('_layer2'))          ents.layer2 = entityId;
      else if (entityId.startsWith('light.')         && local.endsWith('_layer3'))          ents.layer3 = entityId;
      else if (entityId.startsWith('number.')        && local.endsWith('_weight_layer1'))   ents.weight1 = entityId;
      else if (entityId.startsWith('number.')        && local.endsWith('_weight_layer2'))   ents.weight2 = entityId;
      else if (entityId.startsWith('number.')        && local.endsWith('_weight_layer3'))   ents.weight3 = entityId;
      else if (entityId.startsWith('number.')        && local.endsWith('_mix_transition'))  ents.transition = entityId;
      else if (entityId.startsWith('select.')        && local.endsWith('_mode'))            ents.mode = entityId;
      else if (entityId.startsWith('select.')        && local.endsWith('_priority_order'))  ents.priorityOrder = entityId;
      else if (entityId.startsWith('select.')        && local.endsWith('_destination'))     ents.destination = entityId;
      else if (entityId.startsWith('binary_sensor.') && local.endsWith('_layer1_tally'))   ents.tally1 = entityId;
      else if (entityId.startsWith('binary_sensor.') && local.endsWith('_layer2_tally'))   ents.tally2 = entityId;
      else if (entityId.startsWith('binary_sensor.') && local.endsWith('_layer3_tally'))   ents.tally3 = entityId;
      else if (entityId.startsWith('sensor.')        && local.endsWith('_destination_status')) ents.destStatus = entityId;
      // unique_id always ends with '_reset'; entity_id varies by HA version / install history
      else if (entityId.startsWith('button.')        && (entry.unique_id?.endsWith('_reset') || local.endsWith('_reset') || local.endsWith('_reset_all_inputs'))) ents.reset = entityId;
    }
    this._ents = ents;
  }

  _st(entityId) {
    return entityId ? this._hass.states[entityId] : undefined;
  }

  // ─── Build (once) ─────────────────────────────────────────────────────────

  _build() {
    const cfg = this._config;
    const root = this.shadowRoot;
    root.innerHTML = `<style>${this._css()}</style>`;
    const card = document.createElement('ha-card');
    root.appendChild(card);
    const content = document.createElement('div');
    content.className = `content layout-${cfg.layout}`;
    card.appendChild(content);

    if (cfg.layout === 'horizontal') {
      this._buildHorizontal(content, cfg);
    } else {
      this._buildVertical(content, cfg);
    }

    // Align SVG branches to actual icon positions after layout.
    // We observe the reference element (.main-row / .mixer-area).
    // All ResizeObserver callbacks are debounced through requestAnimationFrame
    // so measurements are always taken on a stable, fully-painted frame.
    requestAnimationFrame(() => this._alignSvg());
    if (window.ResizeObserver) {
      if (this._resizeObserver) this._resizeObserver.disconnect();
      const isH = cfg.layout === 'horizontal';
      const refEl = root.querySelector(isH ? '.main-row' : '.mixer-area');
      this._resizeObserver = new ResizeObserver(() => {
        if (this._alignRaf) cancelAnimationFrame(this._alignRaf);
        this._alignRaf = requestAnimationFrame(() => {
          this._alignRaf = null;
          this._alignSvg();
        });
      });
      if (refEl) this._resizeObserver.observe(refEl);
    }
  }

  // ─── SVG alignment (dynamic, post-render) ─────────────────────────────────

  _alignSvg() {
    const root = this.shadowRoot;
    const isH  = this._config.layout === 'horizontal';
    const svg  = root.querySelector(isH ? '.mix-svg-h' : '.mix-svg');
    // ref is the container the SVG covers with position:absolute
    const ref  = root.querySelector(isH ? '.main-row' : '.mixer-area');
    if (!svg || !ref) return;

    const refRect = ref.getBoundingClientRect();
    if (!refRect.width || !refRect.height) {
      requestAnimationFrame(() => this._alignSvg());
      return;
    }

    const f = v => Number(v).toFixed(1);

    // Helper: icon center relative to ref bounding rect
    const center = (sel) => {
      const el = root.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2 - refRect.left, y: r.top + r.height / 2 - refRect.top };
    };

    const W = refRect.width;
    const H = refRect.height;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    // R: radius offset so paths start/end at the circle EDGE (not center).
    // Icon is 54px ⌀ (radius 27px). Arc gauge extends to ~30px from center.
    // R=30 ensures no path goes through the translucent circle background.
    const R = 30;

    if (isH) {
      // ── Horizontal ────────────────────────────────────────────────────────
      // Layout: [left-col] [h-spacer flex:1] [weights-v?] [h-output-col]
      //
      // Step 1: align h-output-col vertically so its icon center = middle input center.
      //   We do this by setting margin-top. If the value changes, schedule a re-run
      //   and return (one extra RAF to let the DOM reflow).
      //
      // Step 2: draw paths. jY = middle input center (= output icon center after step 1).
      //   All 3 branches converge at (jX, jY). Trunk is perfectly H from jX to output.

      const ips = ['layer1', 'layer2', 'layer3'].map(id => center(`[data-ref="${id}"]`) || { x: 0, y: H / 2 });
      const jY = ips[1].y; // target: convergence Y = middle input icon center

      // Align h-output-col: icon top is 0px from column top → icon center = margin-top + 27
      const outColEl = root.querySelector('.h-output-col');
      if (outColEl) {
        const wantedMT = Math.max(0, jY - 27); // 27 = icon radius (output-wrap has no extra padding)
        const gotMT    = parseFloat(outColEl.style.marginTop || '0');
        if (Math.abs(wantedMT - gotMT) > 0.5) {
          outColEl.style.marginTop = `${wantedMT.toFixed(1)}px`;
          requestAnimationFrame(() => this._alignSvg()); // re-run after reflow
          return;
        }
      }

      // Now measure actual positions (output icon should be at jY after margin adjustment)
      const cout = center('[data-ref="output"]') || { x: W - 10, y: jY };

      // Convergence X:
      //   - With faders: right edge of h-spacer (branches in spacer, trunk goes through fader column)
      //   - Without faders: midpoint of available space → balanced branches + trunk
      // All input icons share the same X (vertically stacked, centered in left-col)
      const sX = ips[0].x + R; // right edge of input circles (declared before jX — jX uses sX)

      const spacerEl    = root.querySelector('.h-spacer');
      const hasWeightsV = !!root.querySelector('.weights-v');
      const jX = (hasWeightsV && spacerEl)
        ? spacerEl.getBoundingClientRect().right - refRect.left
        : sX + (cout.x - R - sX) * 0.5; // no faders: 50/50 split

      const mX = (sX + jX) / 2; // elbow X: midpoint in h-spacer

      // Branch paths: right edge of circle → horizontal to elbow → diagonal to convergence
      svg.querySelector('.path-layer1').setAttribute('d',
        `M ${f(sX)} ${f(ips[0].y)} H ${f(mX)} L ${f(jX)} ${f(jY)}`);
      svg.querySelector('.path-layer2').setAttribute('d',
        // L2 is at jY — goes straight horizontal (forms the continuous "spine")
        `M ${f(sX)} ${f(ips[1].y)} H ${f(jX)}`);
      svg.querySelector('.path-layer3').setAttribute('d',
        `M ${f(sX)} ${f(ips[2].y)} H ${f(mX)} L ${f(jX)} ${f(jY)}`);
      // Trunk: perfectly horizontal from convergence to left edge of output circle
      svg.querySelector('.path-output').setAttribute('d',
        `M ${f(jX)} ${f(jY)} H ${f(cout.x - R)}`);

    } else {
      // ── Vertical ──────────────────────────────────────────────────────────
      // Layout: [inputs-row] [v-branch-spacer 40px] [weights-h?] [output-section]
      //
      // The v-branch-spacer gives a dedicated 40px band where the Y-shape is visible.
      // Convergence Y = center of the spacer.
      // Trunk extends from convergence down to the top of the output circle.

      const c1 = center('[data-ref="layer1"]');
      const c2 = center('[data-ref="layer2"]');
      const c3 = center('[data-ref="layer3"]');
      const cout = center('[data-ref="output"]');

      if (!c1 || !c2 || !c3 || !cout) {
        requestAnimationFrame(() => this._alignSvg());
        return;
      }

      // Convergence Y: center of the v-branch-spacer
      const spacerEl  = root.querySelector('.v-branch-spacer');
      const jY = spacerEl
        ? spacerEl.getBoundingClientRect().top + spacerEl.getBoundingClientRect().height / 2 - refRect.top
        : c1.y + 45; // fallback

      const cx = W / 2; // convergence X = horizontal center

      // Branch paths: from bottom edge of each input circle → short vertical stub → diagonal to convergence
      const stub = 14; // px of straight-down segment before branching diagonally
      svg.querySelector('.path-layer1').setAttribute('d',
        `M ${f(c1.x)} ${f(c1.y + R)} V ${f(c1.y + R + stub)} L ${f(cx)} ${f(jY)}`);
      svg.querySelector('.path-layer2').setAttribute('d',
        `M ${f(c2.x)} ${f(c2.y + R)} V ${f(c2.y + R + stub)} L ${f(cx)} ${f(jY)}`);
      svg.querySelector('.path-layer3').setAttribute('d',
        `M ${f(c3.x)} ${f(c3.y + R)} V ${f(c3.y + R + stub)} L ${f(cx)} ${f(jY)}`);
      // Trunk: from convergence straight down to TOP edge of output circle
      svg.querySelector('.path-output').setAttribute('d',
        `M ${f(cx)} ${f(jY)} L ${f(cx)} ${f(cout.y - R)}`);
    }
  }

  // Vertical: inputs → [branch spacer] → weight sliders → output → mode
  // v-branch-spacer gives a fixed 40px area where the Y-shape branches are visible.
  _buildVertical(content, cfg) {
    const mixerArea = document.createElement('div');
    mixerArea.className = 'mixer-area';

    const inputsRow = document.createElement('div');
    inputsRow.className = 'inputs-row';
    inputsRow.appendChild(this._mkLightBtn('layer1', 'Layer 1'));
    inputsRow.appendChild(this._mkLightBtn('layer2', 'Layer 2'));
    inputsRow.appendChild(this._mkLightBtn('layer3', 'Layer 3'));
    mixerArea.appendChild(inputsRow);

    // Dedicated space for branch paths — always present so branches are always readable.
    // Taller when there are no faders (no weights) so the trunk has more room.
    const vSpacer = document.createElement('div');
    vSpacer.className = 'v-branch-spacer';
    mixerArea.appendChild(vSpacer);
    if (!cfg.show_weights) mixerArea.classList.add('no-weights'); // taller spacer via CSS

    if (cfg.show_weights) mixerArea.appendChild(this._mkWeightsH());
    mixerArea.appendChild(this._mkOutputSection(cfg));

    // SVG last in DOM — position:absolute, z-index:-1, behind all content
    mixerArea.appendChild(this._mkSvgVertical());

    content.appendChild(mixerArea);

    if (cfg.show_mode) content.appendChild(this._mkMode());
    if (cfg.show_priority) content.appendChild(this._mkPriorityOrder());
  }

  // Horizontal layout:
  //   [left-col: inputs] [h-spacer: flex:1, branches here] [weights-v?] [h-output-col: output+reset]
  //
  // Rules enforced by this layout:
  //   - Inputs ALWAYS on far left
  //   - Output ALWAYS on far right
  //   - h-spacer fills the middle → gives branches plenty of room to spread
  //   - Faders (weights-v) sit between spacer and output (closer to output)
  //   - Reset is directly below the output icon (no separate row, no big gap)
  //
  // For the trunk to be perfectly horizontal, _alignSvg sets margin-top on h-output-col
  // so the output icon center aligns exactly with the middle input icon center.
  _buildHorizontal(content, cfg) {
    const mainRow = document.createElement('div');
    mainRow.className = 'main-row';

    // Inputs: always far left
    const leftCol = document.createElement('div');
    leftCol.className = 'left-col';
    leftCol.appendChild(this._mkLightBtn('layer1', 'Layer 1'));
    leftCol.appendChild(this._mkLightBtn('layer2', 'Layer 2'));
    leftCol.appendChild(this._mkLightBtn('layer3', 'Layer 3'));
    mainRow.appendChild(leftCol);

    // Spacer: flexible middle area — branches live here
    const hSpacer = document.createElement('div');
    hSpacer.className = 'h-spacer';
    mainRow.appendChild(hSpacer);

    // Faders: fixed-width, closer to output
    if (cfg.show_weights) mainRow.appendChild(this._mkWeightsV());

    // Output + reset: always far right, stacked vertically
    mainRow.appendChild(this._mkHOutputSection(cfg));

    mainRow.appendChild(this._mkSvgHorizontal());
    content.appendChild(mainRow);

    if (cfg.show_mode) content.appendChild(this._mkMode());
    if (cfg.show_priority) content.appendChild(this._mkPriorityOrder());
  }

  // ─── Widget builders ──────────────────────────────────────────────────────

  _mkLightBtn(layer, label) {
    const clickable = this._config.clickable_inputs !== false;
    const btn = document.createElement('button');
    btn.className = 'light-btn' + (clickable ? '' : ' no-click');
    btn.innerHTML = `
      <div class="light-label">${label}</div>
      <div class="light-icon" data-ref="${layer}">
        <ha-icon icon="mdi:lightbulb"></ha-icon>
        <div class="tally-dot" data-tally="${layer}"></div>
        <svg class="arc-gauge" viewBox="0 0 72 72" aria-hidden="true">
          <circle class="arc-track" cx="36" cy="36" r="29" fill="none" stroke-width="2.5" stroke-linecap="round" transform="rotate(135 36 36)"/>
          <circle class="arc-fill"  cx="36" cy="36" r="29" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="0 182.2" transform="rotate(135 36 36)"/>
        </svg>
      </div>
    `;
    if (clickable) {
      btn.addEventListener('click', () => {
        const entityId = this._ents[layer];
        if (entityId) this._fireMoreInfo(entityId);
      });
    }
    return btn;
  }

  _mkOutputSection(cfg) {
    const section = document.createElement('div');
    section.className = 'output-section';
    section.appendChild(this._mkOutputLight(cfg));
    if (cfg.show_reset !== false) section.appendChild(this._mkResetBtn());
    return section;
  }

  // Horizontal-specific output column: output icon + reset, stacked directly.
  // align-self:flex-start + margin-top is set by _alignSvg so the icon center
  // lands exactly at jY (middle input height), keeping the trunk perfectly horizontal.
  _mkHOutputSection(cfg) {
    const col = document.createElement('div');
    col.className = 'h-output-col';
    col.appendChild(this._mkOutputLight(cfg));
    if (cfg.show_reset !== false) col.appendChild(this._mkResetBtn());
    return col;
  }

  _mkOutputLight(cfg) {
    const clickable = cfg.clickable_output !== false;
    const wrap = document.createElement('div');
    wrap.className = 'output-wrap';
    wrap.innerHTML = `
      <div class="light-icon output-icon" data-ref="output" style="cursor:${clickable ? 'pointer' : 'default'}">
        <ha-icon icon="mdi:lightbulb-outline"></ha-icon>
        <svg class="arc-gauge" viewBox="0 0 72 72" aria-hidden="true">
          <circle class="arc-track" cx="36" cy="36" r="29" fill="none" stroke-width="2.5" stroke-linecap="round" transform="rotate(135 36 36)"/>
          <circle class="arc-fill"  cx="36" cy="36" r="29" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="0 182.2" transform="rotate(135 36 36)"/>
        </svg>
      </div>
      <div class="light-label output-label">Output</div>
    `;
    if (clickable) {
      wrap.querySelector('.output-icon').addEventListener('click', () => {
        const destId = this._st(this._ents.destination)?.state;
        if (destId && destId !== 'unknown' && destId !== 'unavailable') {
          this._fireMoreInfo(destId);
        }
      });
    }
    return wrap;
  }

  // 3 horizontal sliders stacked (vertical layout)
  _mkWeightsH() {
    const wrap = document.createElement('div');
    wrap.className = 'weights-h';
    for (const [layer, label] of [['layer1','L1'],['layer2','L2'],['layer3','L3']]) {
      const row = document.createElement('div');
      row.className = 'weight-row';
      row.innerHTML = `
        <span class="weight-label">${label}</span>
        <input type="range" class="weight-slider" data-layer="${layer}" min="0" max="1" step="0.01" value="1"/>
        <span class="weight-value" data-wval="${layer}">1.00</span>
      `;
      row.querySelector('input').addEventListener('input', (e) => {
        row.querySelector(`[data-wval="${layer}"]`).textContent = parseFloat(e.target.value).toFixed(2);
      });
      row.querySelector('input').addEventListener('change', (e) => {
        const eid = this._ents[`weight${layer.slice(-1)}`];
        if (eid) this._hass.callService('number', 'set_value', { entity_id: eid, value: parseFloat(e.target.value) });
      });
      wrap.appendChild(row);
    }
    return wrap;
  }

  // 3 vertical sliders side-by-side (horizontal layout)
  _mkWeightsV() {
    const wrap = document.createElement('div');
    wrap.className = 'weights-v';
    for (const [layer, label] of [['layer1','L1'],['layer2','L2'],['layer3','L3']]) {
      const col = document.createElement('div');
      col.className = 'weight-col';
      col.innerHTML = `
        <span class="weight-label">${label}</span>
        <input type="range" class="weight-slider weight-slider-v" data-layer="${layer}" min="0" max="1" step="0.01" value="1"/>
        <span class="weight-value" data-wval="${layer}">1.00</span>
      `;
      col.querySelector('input').addEventListener('input', (e) => {
        col.querySelector(`[data-wval="${layer}"]`).textContent = parseFloat(e.target.value).toFixed(2);
      });
      col.querySelector('input').addEventListener('change', (e) => {
        const eid = this._ents[`weight${layer.slice(-1)}`];
        if (eid) this._hass.callService('number', 'set_value', { entity_id: eid, value: parseFloat(e.target.value) });
      });
      wrap.appendChild(col);
    }
    return wrap;
  }

  _mkMode() {
    const wrap = document.createElement('div');
    wrap.className = 'mode-wrap';
    wrap.innerHTML = `
      <span class="mode-label">Mode</span>
      <select class="mode-select"></select>
    `;
    wrap.querySelector('select').addEventListener('change', (e) => {
      if (this._ents.mode) {
        this._hass.callService('select', 'select_option', { entity_id: this._ents.mode, option: e.target.value });
      }
    });
    return wrap;
  }

  _mkPriorityOrder() {
    const wrap = document.createElement('div');
    wrap.className = 'mode-wrap';
    wrap.innerHTML = `
      <span class="mode-label">Priorité</span>
      <select class="priority-select"></select>
    `;
    wrap.querySelector('select').addEventListener('change', (e) => {
      if (this._ents.priorityOrder) {
        this._hass.callService('select', 'select_option', { entity_id: this._ents.priorityOrder, option: e.target.value });
      }
    });
    return wrap;
  }

  _mkResetBtn() {
    const btn = document.createElement('button');
    btn.className = 'reset-btn';
    btn.textContent = 'Reset';
    btn.addEventListener('click', () => {
      if (this._ents.reset) this._hass.callService('button', 'press', { entity_id: this._ents.reset });
    });
    return btn;
  }

  // ─── SVG shapes (option B — angular elbows) ───────────────────────────────

  _mkSvgVertical() {
    // Paths are placeholder — _alignSvg() updates them after layout
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 80');
    svg.setAttribute('class', 'mix-svg');
    svg.setAttribute('overflow', 'visible');
    svg.innerHTML = `
      <path class="svg-path path-layer1" d="" fill="none" stroke-width="4" stroke-linecap="square" stroke-linejoin="miter" stroke="#2a2a2a"/>
      <path class="svg-path path-layer2" d="" fill="none" stroke-width="4" stroke-linecap="square" stroke="#2a2a2a"/>
      <path class="svg-path path-layer3" d="" fill="none" stroke-width="4" stroke-linecap="square" stroke-linejoin="miter" stroke="#2a2a2a"/>
      <path class="svg-path path-output" d="" fill="none" stroke-width="4" stroke-linecap="square" stroke="#2a2a2a"/>
    `;
    return svg;
  }

  _mkSvgHorizontal() {
    // Paths are placeholder — _alignSvg() updates them after layout
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 70 110');
    svg.setAttribute('class', 'mix-svg-h');
    svg.setAttribute('overflow', 'visible');
    svg.innerHTML = `
      <path class="svg-path path-layer1" d="" fill="none" stroke-width="4" stroke-linecap="square" stroke-linejoin="miter" stroke="#2a2a2a"/>
      <path class="svg-path path-layer2" d="" fill="none" stroke-width="4" stroke-linecap="square" stroke="#2a2a2a"/>
      <path class="svg-path path-layer3" d="" fill="none" stroke-width="4" stroke-linecap="square" stroke-linejoin="miter" stroke="#2a2a2a"/>
      <path class="svg-path path-output" d="" fill="none" stroke-width="4" stroke-linecap="square" stroke="#2a2a2a"/>
    `;
    return svg;
  }

  _fireMoreInfo(entityId) {
    this.dispatchEvent(new CustomEvent('hass-more-info', {
      detail: { entityId }, bubbles: true, composed: true,
    }));
  }

  // ─── Update (every hass change) ───────────────────────────────────────────

  _update() {
    if (!this._rendered) return;
    const root = this.shadowRoot;
    const { layer1, layer2, layer3, tally1, tally2, tally3, destination } = this._ents;

    const l1State = this._st(layer1);
    const l2State = this._st(layer2);
    const l3State = this._st(layer3);
    const t1 = this._st(tally1)?.state === 'on';
    const t2 = this._st(tally2)?.state === 'on';
    const t3 = this._st(tally3)?.state === 'on';

    const destId   = this._st(destination)?.state;
    const outState = destId ? this._hass.states[destId] : null;

    // Light icons
    this._applyLightIcon(root.querySelector('[data-ref="layer1"]'), l1State, t1);
    this._applyLightIcon(root.querySelector('[data-ref="layer2"]'), l2State, t2);
    this._applyLightIcon(root.querySelector('[data-ref="layer3"]'), l3State, t3);
    this._applyOutputIcon(root.querySelector('[data-ref="output"]'), outState);

    // Tally LEDs
    this._applyTally(root.querySelector('[data-tally="layer1"]'), t1);
    this._applyTally(root.querySelector('[data-tally="layer2"]'), t2);
    this._applyTally(root.querySelector('[data-tally="layer3"]'), t3);

    // SVG path colors
    const ps1 = pathStyle(l1State, t1);
    const ps2 = pathStyle(l2State, t2);
    const ps3 = pathStyle(l3State, t3);
    const outOn  = outState?.state === 'on';
    const outBr  = outOn ? (outState?.attributes?.brightness ?? 255) / 255 : 0;
    const outCol = stateToColor(outState) || 'rgb(255,200,100)';
    const outM   = outOn ? outCol.match(/\d+/g).map(Number) : null;
    const psOut  = {
      stroke: outM
        ? `rgb(${Math.round(outM[0]*outBr)},${Math.round(outM[1]*outBr)},${Math.round(outM[2]*outBr)})`
        : '#2a2a2a',
      filter: outOn && outBr > 0.01
        ? `drop-shadow(0 0 ${(outBr * 14).toFixed(1)}px ${colorToRgba(outCol, outBr * 0.95)}) drop-shadow(0 0 ${(outBr * 5).toFixed(1)}px ${colorToRgba(outCol, outBr * 0.8)})`
        : 'none',
    };

    const applyPath = (sel, ps) => root.querySelectorAll(sel).forEach(p => {
      p.style.stroke = ps.stroke;
      p.style.filter = ps.filter;
    });
    applyPath('.path-layer1', ps1);
    applyPath('.path-layer2', ps2);
    applyPath('.path-layer3', ps3);
    applyPath('.path-output',  psOut);

    // Weight sliders — skip update while the slider is focused to avoid fighting user input
    for (const [layer, key] of [['layer1','weight1'],['layer2','weight2'],['layer3','weight3']]) {
      const st = this._st(this._ents[key]);
      const sliders = root.querySelectorAll(`[data-layer="${layer}"]`);
      sliders.forEach(el => {
        if (st && !el.matches(':focus')) {
          el.value = st.state;
          const valEl = root.querySelector(`[data-wval="${layer}"]`);
          if (valEl) valEl.textContent = parseFloat(st.state).toFixed(2);
        }
      });
    }

    // Mode select
    const modeState = this._st(this._ents.mode);
    const modeEl = root.querySelector('.mode-select');
    if (modeEl && modeState) {
      const opts = modeState.attributes.options || [];
      const cur  = Array.from(modeEl.options).map(o => o.value);
      if (JSON.stringify(cur) !== JSON.stringify(opts)) {
        modeEl.innerHTML = opts.map(o =>
          `<option value="${o}">${MODE_LABELS[o] || o}</option>`
        ).join('');
      }
      if (!modeEl.matches(':focus')) modeEl.value = modeState.state;
    }

    // Priority order select
    const prioState = this._st(this._ents.priorityOrder);
    const prioEl = root.querySelector('.priority-select');
    if (prioEl && prioState) {
      const opts = prioState.attributes.options || [];
      const cur  = Array.from(prioEl.options).map(o => o.value);
      if (JSON.stringify(cur) !== JSON.stringify(opts)) {
        prioEl.innerHTML = opts.map(o => `<option value="${o}">${o}</option>`).join('');
      }
      if (!prioEl.matches(':focus')) prioEl.value = prioState.state;
    }

    // Output label
    const outputLabel = root.querySelector('.output-label');
    if (outputLabel) {
      const name = outState?.attributes?.friendly_name
        || (destId && destId !== 'unknown' ? destId : null)
        || 'Output';
      outputLabel.textContent = name;
    }
  }

  _applyLightIcon(el, state, isTally) {
    if (!el) return;
    const isOn = state?.state === 'on';
    const color = stateToColor(state);
    const br = isOn ? (state?.attributes?.brightness ?? 0) : 0;
    const t  = br / 255;
    const ca = (a) => colorToRgba(color, a);

    // Circle styles
    el.style.background  = isOn ? ca(0.05 + t * 0.07) : '#1c1c1c';
    el.style.borderColor = isOn ? ca(0.18 + t * 0.32) : 'transparent';
    el.style.boxShadow   = isOn && t > 0
      ? `0 0 ${(5 + t * 18).toFixed(1)}px ${(t * 6).toFixed(1)}px ${ca(0.2 + t * 0.35)}`
      : 'none';
    el.style.opacity = isTally ? '1' : (isOn ? '0.55' : '0.35');

    const icon = el.querySelector('ha-icon');
    if (icon) icon.style.color = isOn ? ca(0.5 + t * 0.5) : '#555';

    // Arc gauge
    const r = 29, circ = 2 * Math.PI * r;
    const arcLen = circ * 0.75;
    const track  = el.querySelector('.arc-track');
    const fillEl = el.querySelector('.arc-fill');
    if (track)  track.setAttribute('stroke', isOn ? ca(0.15) : '#252d3a');
    if (fillEl) {
      fillEl.setAttribute('stroke', isOn ? (color || 'rgb(255,200,100)') : 'transparent');
      fillEl.setAttribute('stroke-dasharray', `${(t * arcLen).toFixed(1)} ${circ.toFixed(1)}`);
      fillEl.style.filter = isOn && t > 0
        ? `drop-shadow(0 0 ${(t * 3).toFixed(1)}px ${ca(t * 0.8)})`
        : 'none';
    }
  }

  _applyOutputIcon(el, state) {
    if (!el) return;
    const isOn = state?.state === 'on';
    const color = stateToColor(state);
    const br = isOn ? (state?.attributes?.brightness ?? 0) : 0;
    const t  = br / 255;
    const ca = (a) => colorToRgba(color, a);

    // Circle styles
    el.style.background  = isOn ? ca(0.05 + t * 0.07) : '#1c1c1c';
    el.style.borderColor = isOn ? ca(0.18 + t * 0.32) : '#333';
    el.style.boxShadow   = isOn && t > 0
      ? `0 0 ${(5 + t * 18).toFixed(1)}px ${(t * 6).toFixed(1)}px ${ca(0.2 + t * 0.35)}`
      : 'none';
    el.style.opacity = '1';

    const icon = el.querySelector('ha-icon');
    if (icon) icon.style.color = isOn ? ca(0.5 + t * 0.5) : '#555';

    // Arc gauge
    const r = 29, circ = 2 * Math.PI * r;
    const arcLen = circ * 0.75;
    const track  = el.querySelector('.arc-track');
    const fillEl = el.querySelector('.arc-fill');
    if (track)  track.setAttribute('stroke', isOn ? ca(0.15) : '#252d3a');
    if (fillEl) {
      fillEl.setAttribute('stroke', isOn ? (color || 'rgb(255,200,100)') : 'transparent');
      fillEl.setAttribute('stroke-dasharray', `${(t * arcLen).toFixed(1)} ${circ.toFixed(1)}`);
      fillEl.style.filter = isOn && t > 0
        ? `drop-shadow(0 0 ${(t * 3).toFixed(1)}px ${ca(t * 0.8)})`
        : 'none';
    }
  }

  _applyTally(el, isActive) {
    if (!el) return;
    if (this._config.show_tally === false) {
      el.style.display = 'none';
      return;
    }
    el.style.display    = '';
    el.style.background = isActive ? '#cc1111' : '#1a0202';
    el.style.boxShadow  = isActive ? '0 0 5px #cc1111' : 'none';
  }

  // ─── Styles ───────────────────────────────────────────────────────────────

  _css() {
    return `
      :host { display: block; }
      ha-card { padding: 16px 16px 12px; }

      .content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
      }

      /* ── Vertical ── */

      /* .mixer-area wraps inputs + weights + output in vertical mode.
         The SVG is position:absolute inside it (z-index:-1), so it sits
         behind everything without needing overflow tricks. */
      .mixer-area {
        position: relative;
        isolation: isolate;   /* stacking context → z-index:-1 SVG stays inside */
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        width: 100%;
      }

      .inputs-row {
        display: flex;
        flex-direction: row;
        justify-content: space-around;
        width: 100%;
      }

      /* Vertical SVG: absolute, covers full .mixer-area, behind all content */
      .mix-svg {
        position: absolute;
        top: 0; left: 0;
        width: 100%; height: 100%;
        pointer-events: none;
        z-index: -1;
        overflow: visible;   /* allows glow to bleed out slightly */
      }

      .path-layer1, .path-layer2, .path-layer3, .path-output {
        transition: stroke 0.3s ease, filter 0.3s ease;
      }

      /* ── Horizontal ── */
      .main-row {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 8px;
        position: relative;
        isolation: isolate;   /* stacking context for the horizontal SVG */
        width: 100%;
      }

      .left-col {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
        position: relative;
      }

      /* Horizontal SVG: absolute, covers full .main-row, behind all content */
      .mix-svg-h {
        position: absolute;
        left: 0; top: 0;
        width: 100%; height: 100%;
        overflow: visible;
        pointer-events: none;
        z-index: -1;
      }

      /* ── Output section ── */
      .output-section {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }

      .output-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
        flex-shrink: 0;
      }

      /* ── SVG paths ── */
      .svg-path { transition: stroke 0.4s ease; }

      /* ── Light icons ── */
      .light-btn {
        background: none;
        border: none;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
        padding: 4px;
      }
      .light-btn.no-click { cursor: default; }

      /* Vertical layout: extra gap between label (above) and icon so arc glow doesn't bleed on it */
      .inputs-row .light-btn { gap: 12px; }

      /* Horizontal layout: labels go below the icon (reverse column order) */
      .left-col .light-btn { flex-direction: column-reverse; }

      .light-icon, .output-icon {
        position: relative;
        width: 54px;
        height: 54px;
        border-radius: 50%;
        background: #1c1c1c;
        border: 2px solid transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.3s, box-shadow 0.3s, opacity 0.3s, border-color 0.3s;
      }

      .light-icon ha-icon,
      .output-icon ha-icon {
        --mdc-icon-size: 26px;
        transition: color 0.3s;
      }

      .arc-gauge {
        position: absolute;
        top: -9px; left: -9px;
        width: 72px; height: 72px;
        overflow: visible;
        pointer-events: none;
      }
      .arc-track { transition: stroke 0.3s; }
      .arc-fill  { transition: stroke-dasharray 0.3s ease, stroke 0.3s, filter 0.3s; }

      .light-label {
        font-size: 11px;
        color: var(--secondary-text-color, #888);
        white-space: nowrap;
        max-width: 68px;
        overflow: hidden;
        text-overflow: ellipsis;
        text-align: center;
      }

      /* ── Tally LED ── */
      .tally-dot {
        position: absolute;
        top: -6px;
        right: -6px;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #1a0202;
        box-shadow: none;
        z-index: 2;
        transition: background 0.15s, box-shadow 0.15s;
        pointer-events: none;
      }

      /* ── Horizontal weight sliders (vertical layout) ── */
      .weights-h {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 2px 0;
      }

      .weight-row {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .weight-label {
        font-size: 10px;
        font-weight: 600;
        color: var(--secondary-text-color, #888);
        width: 16px;
        flex-shrink: 0;
        user-select: none;
      }

      .weight-slider {
        flex: 1;
        accent-color: var(--primary-color, #03a9f4);
        cursor: pointer;
      }

      .weight-value {
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        color: var(--primary-text-color, #fff);
        width: 30px;
        text-align: right;
        flex-shrink: 0;
      }

      /* ── Vertical weight sliders (horizontal layout) ── */
      .weights-v {
        position: relative;
        display: flex;
        flex-direction: row;
        align-items: stretch;
        align-self: stretch;
        gap: 6px;
        flex-shrink: 0;   /* fixed width — h-spacer takes the flexible space */
      }

      /* ── Horizontal spacer: flexible gap between inputs and faders/output ── */
      /* This is where the branch paths live. */
      .h-spacer {
        flex: 1;
        min-width: 20px;  /* always some space even on very narrow cards */
      }

      /* ── Vertical branch spacer: area between inputs and sliders where Y-shape lives ── */
      .v-branch-spacer {
        height: 40px;
        width: 100%;
        flex-shrink: 0;
      }
      /* Without faders, output is right below the spacer — needs more height for trunk room */
      .mixer-area.no-weights .v-branch-spacer {
        height: 80px;
      }

      /* ── Horizontal output column: output icon + reset, stacked directly ── */
      /* align-self:flex-start + JS margin-top ensures icon center = middle input Y */
      .h-output-col {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
        align-self: flex-start;  /* JS sets margin-top to align icon center */
      }

      .weight-col {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: space-between;
        gap: 3px;
        height: 100%;
      }

      .weight-slider-v {
        writing-mode: vertical-lr;
        direction: rtl;
        flex: 1;
        min-height: 0;
        width: 24px;
        accent-color: var(--primary-color, #03a9f4);
        cursor: pointer;
      }

      /* ── Mode (full-width, both layouts) ── */
      .mode-wrap {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 8px;
        width: 100%;
      }

      .mode-label {
        font-size: 11px;
        color: var(--secondary-text-color, #888);
        text-transform: uppercase;
        letter-spacing: 0.4px;
        white-space: nowrap;
      }

      .mode-select,
      .priority-select {
        flex: 1;
        min-width: 0;
        background: var(--card-background-color, #1c1c1c);
        color: var(--primary-text-color, #fff);
        border: 1px solid var(--divider-color, #444);
        border-radius: 6px;
        padding: 5px 8px;
        font-size: 12px;
        cursor: pointer;
      }

      /* ── Reset ── */
      .reset-btn {
        background: none;
        border: 1px solid var(--error-color, #cf6679);
        color: var(--error-color, #cf6679);
        border-radius: 6px;
        padding: 5px 14px;
        cursor: pointer;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        transition: background 0.2s, color 0.2s;
      }
      .reset-btn:hover {
        background: var(--error-color, #cf6679);
        color: #fff;
      }

      .layout-horizontal .reset-btn {
        width: 54px;
        padding: 5px 2px;
        letter-spacing: 0;
        font-size: 10px;
      }
    `;
  }
}

customElements.define('light-mixer-card', LightMixerCard);

// ─── Config editor ────────────────────────────────────────────────────────────

class LightMixerCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._config = null;
  }

  set hass(hass) {
    this._hass = hass;
    // Only do a full render on first hass assignment; subsequent hass updates
    // (which happen frequently) must NOT replace the DOM — native <select>
    // popovers lose their target and swallow the user's click on macOS/Brave.
    if (!this._rendered) this._render();
  }

  setConfig(config) {
    this._config = config;
    this._rendered = false; // config changed externally → allow next full render
    this._render();
  }

  _mixerDevices() {
    if (!this._hass?.entities) return [];
    const seen = new Set();
    for (const [entityId, entry] of Object.entries(this._hass.entities)) {
      const local = entityId.split('.')[1] || '';
      if (entityId.startsWith('binary_sensor.') && local.endsWith('_layer1_tally') && entry.device_id) {
        seen.add(entry.device_id);
      }
    }
    return Array.from(seen).map(id => {
      const dev = this._hass.devices?.[id];
      return { id, name: dev?.name_by_user || dev?.name || id };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  _toggle(id, checked) {
    return `<label class="toggle"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}/><span class="toggle-track"></span></label>`;
  }

  _render() {
    if (!this._hass || !this._config) return;
    const cfg = this._config;
    const devices = this._mixerDevices();

    this.shadowRoot.innerHTML = `
      <style>
        .form { display: flex; flex-direction: column; gap: 18px; padding: 16px; }
        .field { display: flex; flex-direction: column; gap: 6px; }
        .field label { font-size: 12px; font-weight: 500; color: var(--secondary-text-color, #888); text-transform: uppercase; letter-spacing: 0.4px; }
        select { padding: 8px 10px; border: 1px solid var(--divider-color, #444); border-radius: 6px; background: var(--card-background-color, #1c1c1c); color: var(--primary-text-color, #fff); font-size: 14px; cursor: pointer; }
        select:focus { outline: 2px solid var(--primary-color, #03a9f4); }
        .no-devices { font-size: 13px; color: var(--error-color, #cf6679); padding: 4px 0; }
        .section-title { font-size: 11px; font-weight: 600; color: var(--secondary-text-color, #888); text-transform: uppercase; letter-spacing: 0.5px; padding-top: 4px; border-top: 1px solid var(--divider-color, #333); }
        .toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 2px 0; }
        .toggle-label { font-size: 14px; color: var(--primary-text-color, #fff); }
        .toggle { position: relative; display: inline-block; width: 40px; height: 22px; }
        .toggle input { opacity: 0; width: 0; height: 0; }
        .toggle-track { position: absolute; inset: 0; background: var(--divider-color, #444); border-radius: 22px; cursor: pointer; transition: background 0.2s; }
        .toggle-track::before { content: ''; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: transform 0.2s; }
        input:checked + .toggle-track { background: var(--primary-color, #03a9f4); }
        input:checked + .toggle-track::before { transform: translateX(18px); }
      </style>
      <div class="form">
        <div class="field">
          <label>Appareil Light Mixer</label>
          ${devices.length === 0
            ? `<span class="no-devices">Aucun appareil Light Mixer détecté</span>
               <select id="device_id"><option value="${cfg.device_id || ''}">${cfg.device_id || '-- aucun --'}</option></select>`
            : `<select id="device_id">
                 <option value="">-- Sélectionner --</option>
                 ${devices.map(d => `<option value="${d.id}" ${cfg.device_id === d.id ? 'selected' : ''}>${d.name}</option>`).join('')}
               </select>`
          }
        </div>
        <div class="field">
          <label>Disposition</label>
          <select id="layout">
            <option value="vertical"   ${cfg.layout !== 'horizontal' ? 'selected' : ''}>Vertical</option>
            <option value="horizontal" ${cfg.layout === 'horizontal'  ? 'selected' : ''}>Horizontal</option>
          </select>
        </div>
        <div class="section-title">Affichage</div>
        <div class="toggle-row"><span class="toggle-label">Sliders de mix</span>${this._toggle('show_weights', cfg.show_weights !== false)}</div>
        <div class="toggle-row"><span class="toggle-label">Sélecteur de mode</span>${this._toggle('show_mode', cfg.show_mode !== false)}</div>
        <div class="toggle-row"><span class="toggle-label">Ordre de priorité</span>${this._toggle('show_priority', cfg.show_priority !== false)}</div>
        <div class="toggle-row"><span class="toggle-label">Tally (LEDs)</span>${this._toggle('show_tally', cfg.show_tally !== false)}</div>
        <div class="toggle-row"><span class="toggle-label">Bouton Reset</span>${this._toggle('show_reset', cfg.show_reset !== false)}</div>
        <div class="section-title">Interactions</div>
        <div class="toggle-row"><span class="toggle-label">Inputs cliquables</span>${this._toggle('clickable_inputs', cfg.clickable_inputs !== false)}</div>
        <div class="toggle-row"><span class="toggle-label">Output cliquable</span>${this._toggle('clickable_output', cfg.clickable_output !== false)}</div>
      </div>
    `;

    const on = (id, key, bool = true) => {
      this.shadowRoot.querySelector(`#${id}`)?.addEventListener('change', (e) =>
        this._fire({ ...cfg, [key]: bool ? e.target.checked : e.target.value }));
    };
    on('device_id',        'device_id',        false);
    on('layout',           'layout',           false);
    on('show_weights',     'show_weights');
    on('show_mode',        'show_mode');
    on('show_priority',    'show_priority');
    on('show_tally',       'show_tally');
    on('show_reset',       'show_reset');
    on('clickable_inputs', 'clickable_inputs');
    on('clickable_output', 'clickable_output');

    this._rendered = true;
  }

  _fire(newConfig) {
    this._config = newConfig;
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: newConfig }, bubbles: true, composed: true,
    }));
  }
}

customElements.define('light-mixer-card-editor', LightMixerCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'light-mixer-card',
  name: 'Light Mixer Card',
  description: 'Visual 3-layer mixer for the Light Mixer integration',
  preview: true,
});
