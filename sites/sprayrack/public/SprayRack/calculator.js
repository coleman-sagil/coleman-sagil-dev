/* Spray Rack Sizing Calculator — vanilla JS, no dependencies.
   All hydraulics here are independently derived from standard formulas
   (cited inline below and on the page itself), not copied from any
   vendor's sizing tool or lookup table. Every function below maps
   directly to a formula shown in index.html's #results section. */

'use strict';

(function () {

  /* --------------------------------------------------------------------
     Constants — every one of these is also stated in plain language on
     the page itself, next to the number it feeds.
     -------------------------------------------------------------------- */

  // 1 ft of water column = 0.433 psi (density of fresh water, 62.4
  // lb/ft^3, divided by 144 in^2/ft^2). Standard hydrostatic conversion.
  var PSI_PER_FT_HEAD = 0.433;

  // psi -> ft of head. The true reciprocal of 0.433 is 1 / 0.433 =
  // 2.3095..., but pump-sizing references conventionally pair 0.433
  // with the rounded 2.31 rather than the exact reciprocal, so this
  // tool matches that convention rather than "fixing" the rounding.
  var FT_HEAD_PER_PSI = 2.31;

  // Hydraulic horsepower for water (specific gravity = 1):
  //   HHP = (GPM x head_ft) / 3960
  // 3960 comes from 33,000 ft*lb/min per HP divided by 8.33 lb/gal of
  // water — a standard constant in any centrifugal-pump reference.
  var HHP_CONSTANT = 3960;

  // Rule-of-thumb brake-HP estimate: assume ~50% overall pump
  // efficiency at this flow/head unless a real pump curve says
  // otherwise. Documented on the page as an estimate, not a spec.
  var ASSUMED_PUMP_EFFICIENCY = 0.5;

  // Booster tiers: a fixed, documented psi boost per tier (see the note
  // in the Site Conditions section of index.html for where these two
  // numbers come from — round figures for a 1/2 HP and 1 HP inline
  // centrifugal booster pump's low-flow head, not a specific vendor's
  // published curve).
  var BOOSTER_PSI = { none: 0, half: 20, one: 40 };
  var BOOSTER_ORDER = ['none', 'half', 'one'];
  var BOOSTER_LABEL = { none: 'no booster', half: 'the 0.5 HP booster', one: 'the 1 HP booster' };

  /* --------------------------------------------------------------------
     Small helpers
     -------------------------------------------------------------------- */

  // Coerce any form-field value to a finite number, defaulting a blank
  // or non-numeric field to 0 rather than letting NaN propagate through
  // every downstream calculation.
  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function fmt(n, digits) {
    if (!isFinite(n)) { return '—'; }
    return n.toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function $(id) { return document.getElementById(id); }

  /* --------------------------------------------------------------------
     Hazen-Williams friction loss (US customary units, psi form):
       psi_loss = 4.52 * L * Q^1.852 / (C^1.852 * d^4.8655)
     where L = hose length (ft), Q = flow (GPM), d = inner diameter
     (in), C = roughness coefficient. This is the standard US-customary
     Hazen-Williams equation as used throughout fire-protection
     hydraulics (e.g. NFPA 13 sprinkler calculations) and irrigation
     engineering references — not a fabricated or proprietary formula.

     Equivalent SI-flavored form found in many textbooks, as a
     cross-check on the constant above:
       h_f (ft per 100 ft) = 0.2083 * (100/C)^1.852 * Q^1.852 / d^4.8655
     Converting that to psi per foot of run (divide by 2.31 ft/psi and
     by 100 ft) collapses to the same 4.52-ish constant used directly
     above, up to rounding — the two commonly-published forms agree.
     -------------------------------------------------------------------- */
  function hazenWilliamsPsiLoss(qGpm, lengthFt, diameterIn, cCoef) {
    if (!(qGpm > 0) || !(lengthFt > 0) || !(diameterIn > 0) || !(cCoef > 0)) {
      return 0;
    }
    return (4.52 * lengthFt * Math.pow(qGpm, 1.852)) /
      (Math.pow(cCoef, 1.852) * Math.pow(diameterIn, 4.8655));
  }

  /* --------------------------------------------------------------------
     Equipment rows — read straight from the DOM on every recalculation
     rather than maintaining a parallel JS array, so the table stays the
     single source of truth and can never drift out of sync with it.
     -------------------------------------------------------------------- */

  function readEquipmentRows() {
    var rowEls = document.querySelectorAll('#equip-body .equip-row');
    var rows = [];
    rowEls.forEach(function (row) {
      var name = row.querySelector('.equip-name').value.trim() || 'Unnamed row';
      var qty = num(row.querySelector('.equip-qty').value);
      var gpm = num(row.querySelector('.equip-gpm').value);
      var psi = num(row.querySelector('.equip-psi').value);
      rows.push({ name: name, qty: qty, gpm: gpm, psi: psi });
    });
    return rows;
  }

  function getDiameterIn() {
    var sel = $('hose-diameter').value;
    if (sel === 'custom') {
      return num($('hose-diameter-custom').value);
    }
    return parseFloat(sel);
  }

  /* --------------------------------------------------------------------
     Row management: add via <template> cloning (never innerHTML with a
     user-supplied name, so a row named e.g. "<script>" can't touch the
     page's markup), remove via event delegation on the table body so
     dynamically-added rows work without individually re-binding a
     listener to each one.
     -------------------------------------------------------------------- */

  function addEquipRow() {
    var tpl = $('equip-row-template');
    var body = $('equip-body');
    var clone = tpl.content.cloneNode(true);
    body.appendChild(clone);
    recalculate();
  }

  function initEquipmentTable() {
    $('add-equip-row').addEventListener('click', addEquipRow);

    var body = $('equip-body');
    body.addEventListener('click', function (evt) {
      var btn = evt.target.closest('.btn-remove-row');
      if (!btn) { return; }
      var row = btn.closest('.equip-row');
      var allRows = body.querySelectorAll('.equip-row');
      // Never let the table drop to zero rows silently — removing the
      // last row would leave an empty equipment list, which is a valid
      // state the calculator already handles (MAX of an empty set ->
      // 0), so this is just a UX guard, not a correctness requirement.
      if (allRows.length <= 1) {
        row.querySelector('.equip-name').value = '';
        row.querySelector('.equip-qty').value = 0;
        row.querySelector('.equip-gpm').value = 0;
        row.querySelector('.equip-psi').value = 0;
      } else {
        row.remove();
      }
      recalculate();
    });

    // Single delegated input listener covers every current row and
    // every row added later, instead of re-binding per row.
    body.addEventListener('input', recalculate);
  }

  function initDiameterField() {
    var sel = $('hose-diameter');
    var customField = $('hose-diameter-custom-field');
    function sync() {
      customField.hidden = sel.value !== 'custom';
    }
    sel.addEventListener('change', function () { sync(); recalculate(); });
    sync();
  }

  /* --------------------------------------------------------------------
     Main calculation + render
     -------------------------------------------------------------------- */

  function recalculate() {
    var equipment = readEquipmentRows();

    var totalFlowGpm = equipment.reduce(function (sum, row) {
      return sum + row.qty * row.gpm;
    }, 0);

    // MAX, not sum — equipment sharing one manifold is a parallel
    // circuit; the manifold only has to clear the single highest
    // per-unit minimum. Math.max() over an empty array is -Infinity,
    // so that case is guarded explicitly rather than trusted to fall
    // out of the reduce.
    var maxEquipPsi = equipment.length
      ? Math.max.apply(null, equipment.map(function (row) { return row.psi; }))
      : 0;

    var hoseLengthFt = num($('hose-length').value);
    var elevationLiftFt = num($('elevation-lift').value);
    var diameterIn = getDiameterIn();
    var cCoef = num($('hw-c').value) || 150;

    var elevationLossPsi = PSI_PER_FT_HEAD * elevationLiftFt;
    var frictionLossPsi = hazenWilliamsPsiLoss(totalFlowGpm, hoseLengthFt, diameterIn, cCoef);
    var totalRequiredPsi = maxEquipPsi + frictionLossPsi + elevationLossPsi;

    var sitePressurePsi = num($('site-pressure').value);
    var boosterTier = $('booster-select').value;
    var boosterPsi = BOOSTER_PSI[boosterTier] || 0;
    var availablePsi = sitePressurePsi + boosterPsi;
    var isAdequate = availablePsi >= totalRequiredPsi;
    var gapPsi = totalRequiredPsi - availablePsi;

    // Smallest booster tier (checked against the RAW site pressure,
    // independent of whatever tier happens to be selected right now)
    // that would close the gap on its own. null means even the largest
    // tier modeled here isn't enough.
    var neededTier = null;
    for (var i = 0; i < BOOSTER_ORDER.length; i++) {
      var t = BOOSTER_ORDER[i];
      if (sitePressurePsi + BOOSTER_PSI[t] >= totalRequiredPsi) {
        neededTier = t;
        break;
      }
    }

    var totalHeadFt = totalRequiredPsi * FT_HEAD_PER_PSI;
    var hydraulicHp = (totalFlowGpm * totalHeadFt) / HHP_CONSTANT;
    var brakeHp = hydraulicHp / ASSUMED_PUMP_EFFICIENCY;

    render({
      equipment: equipment,
      totalFlowGpm: totalFlowGpm,
      maxEquipPsi: maxEquipPsi,
      hoseLengthFt: hoseLengthFt,
      elevationLiftFt: elevationLiftFt,
      diameterIn: diameterIn,
      cCoef: cCoef,
      elevationLossPsi: elevationLossPsi,
      frictionLossPsi: frictionLossPsi,
      totalRequiredPsi: totalRequiredPsi,
      sitePressurePsi: sitePressurePsi,
      boosterTier: boosterTier,
      boosterPsi: boosterPsi,
      availablePsi: availablePsi,
      isAdequate: isAdequate,
      gapPsi: gapPsi,
      neededTier: neededTier,
      totalHeadFt: totalHeadFt,
      hydraulicHp: hydraulicHp,
      brakeHp: brakeHp
    });
  }

  function render(r) {
    // Hero live stats
    $('hero-flow').textContent = fmt(r.totalFlowGpm, 1);
    $('hero-pressure').textContent = fmt(r.totalRequiredPsi, 1);
    $('hero-status').textContent = r.isAdequate ? 'Pass' : 'Insufficient';
    $('hero-status').style.color = r.isAdequate ? 'var(--good)' : 'var(--bad)';

    // Result cards
    $('r-flow').textContent = fmt(r.totalFlowGpm, 1);
    $('r-flow-plugged').textContent = plugFlow(r.equipment, r.totalFlowGpm);

    $('r-elevation').textContent = fmt(r.elevationLossPsi, 2);
    $('r-elevation-plugged').textContent =
      '= 0.433 × ' + fmt(r.elevationLiftFt, 1) + ' ft = ' + fmt(r.elevationLossPsi, 2) + ' psi';

    $('r-friction').textContent = fmt(r.frictionLossPsi, 2);
    $('r-friction-plugged').textContent =
      '= 4.52 × ' + fmt(r.hoseLengthFt, 0) + ' × ' + fmt(r.totalFlowGpm, 1) + '^1.852 ÷ (' +
      fmt(r.cCoef, 0) + '^1.852 × ' + fmt(r.diameterIn, 3) + '^4.8655) = ' + fmt(r.frictionLossPsi, 2) + ' psi';

    $('r-equip-psi').textContent = fmt(r.maxEquipPsi, 1);
    $('r-equip-psi-plugged').textContent = plugMaxPsi(r.equipment, r.maxEquipPsi);

    $('r-total-psi').textContent = fmt(r.totalRequiredPsi, 2);
    $('r-total-psi-plugged').textContent =
      '= ' + fmt(r.maxEquipPsi, 1) + ' + ' + fmt(r.frictionLossPsi, 2) + ' + ' + fmt(r.elevationLossPsi, 2) +
      ' = ' + fmt(r.totalRequiredPsi, 2) + ' psi';

    // Adequacy panel
    var badge = $('adequacy-badge');
    var detail = $('adequacy-detail');
    badge.classList.remove('is-good', 'is-bad');
    if (r.isAdequate) {
      badge.classList.add('is-good');
      badge.textContent = 'Pass — supply is adequate';
      detail.textContent =
        'Available pressure (' + fmt(r.sitePressurePsi, 1) + ' psi site + ' + fmt(r.boosterPsi, 0) +
        ' psi from ' + BOOSTER_LABEL[r.boosterTier] + ' = ' + fmt(r.availablePsi, 1) +
        ' psi) clears the ' + fmt(r.totalRequiredPsi, 2) + ' psi required by ' +
        fmt(Math.abs(r.gapPsi), 2) + ' psi.';
    } else {
      badge.classList.add('is-bad');
      badge.textContent = 'Insufficient — supply falls short';
      var msg =
        'Available pressure (' + fmt(r.sitePressurePsi, 1) + ' psi site + ' + fmt(r.boosterPsi, 0) +
        ' psi from ' + BOOSTER_LABEL[r.boosterTier] + ' = ' + fmt(r.availablePsi, 1) +
        ' psi) falls short of the ' + fmt(r.totalRequiredPsi, 2) + ' psi required by ' +
        fmt(r.gapPsi, 2) + ' psi.';
      if (r.neededTier === null) {
        msg += ' Even the largest booster tier modeled here (1 HP, +' + BOOSTER_PSI.one +
          ' psi) is not enough on its own — raising site pressure, shortening/upsizing the hose, ' +
          'or reducing equipment demand would all help close the gap.';
      } else {
        // BOOSTER_PSI is monotonically increasing along BOOSTER_ORDER and
        // this branch only runs when the CURRENTLY selected tier already
        // failed to close the gap, so neededTier here is always a
        // strictly larger tier than whatever is currently selected —
        // never 'none' and never equal to boosterTier.
        msg += ' Selecting ' + BOOSTER_LABEL[r.neededTier] + ' would close the gap on its own.';
      }
      detail.textContent = msg;
    }

    // Pump sizing
    $('r-head').textContent = fmt(r.totalHeadFt, 1);
    $('r-head-plugged').textContent =
      '= ' + fmt(r.totalRequiredPsi, 2) + ' × 2.31 = ' + fmt(r.totalHeadFt, 1) + ' ft';

    $('r-hhp').textContent = fmt(r.hydraulicHp, 2);
    $('r-hhp-plugged').textContent =
      '= (' + fmt(r.totalFlowGpm, 1) + ' × ' + fmt(r.totalHeadFt, 1) + ') ÷ 3960 = ' + fmt(r.hydraulicHp, 2) + ' HP';

    $('r-bhp').textContent = fmt(r.brakeHp, 2);
    $('r-bhp-plugged').textContent =
      '= ' + fmt(r.hydraulicHp, 2) + ' ÷ 0.5 = ' + fmt(r.brakeHp, 2) + ' HP (rule-of-thumb estimate)';
  }

  function plugFlow(equipment, total) {
    if (!equipment.length) { return '= 0 GPM (no equipment rows)'; }
    var terms = equipment.map(function (row) {
      return fmt(row.qty, 0) + '×' + fmt(row.gpm, 1);
    });
    return '= ' + terms.join(' + ') + ' = ' + fmt(total, 1) + ' GPM';
  }

  function plugMaxPsi(equipment, max) {
    if (!equipment.length) { return '= 0 psi (no equipment rows)'; }
    var terms = equipment.map(function (row) { return fmt(row.psi, 0); });
    return '= MAX(' + terms.join(', ') + ') = ' + fmt(max, 1) + ' psi';
  }

  /* --------------------------------------------------------------------
     Wire up: every non-table field just needs one shared input listener;
     the equipment table's own listeners are set up in initEquipmentTable.
     -------------------------------------------------------------------- */

  function init() {
    initEquipmentTable();
    initDiameterField();

    var fieldIds = ['hose-diameter-custom', 'hose-length', 'elevation-lift',
      'site-pressure', 'booster-select', 'hw-c'];
    fieldIds.forEach(function (id) {
      var el = $(id);
      el.addEventListener('input', recalculate);
      el.addEventListener('change', recalculate);
    });

    recalculate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
