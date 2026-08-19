/* Windmaker Pressure-Difference Calculator — vanilla JS, no dependencies.
   Sizes the AIR-pressure side of an ASTM E1105-15(2023) field water test:
   required blower airflow, Magnehelic gauge target, and duration. Every
   constant here is also stated in plain language on the page itself, next
   to the number it feeds — cited inline below, not copied from any
   vendor's sizing tool. This file is self-contained on purpose (this
   codebase does not share JS between pages); it duplicates the
   num()/fmt()/$() helper pattern from calculator.js rather than
   importing it. */

'use strict';

(function () {

  /* --------------------------------------------------------------------
     Constants — every one of these is also stated in plain language on
     the page itself, next to the number it feeds.
     -------------------------------------------------------------------- */

  // The two reference air-leakage test pressures fenestration labels
  // actually get tested/reported against — E283 itself fixes neither; its
  // own title is "...Under Specified Pressure Differences Across the
  // Specimen". NFRC 400 and the IECC/IRC air-leakage sections invoke 75
  // Pa/1.57 psf when they cite E283 (the common case); some NAFS/AAMA
  // structural testing instead invokes 300 Pa/6.24 psf. Both headline
  // values are each independently-rounded conversions FROM their Pa
  // figure via full-precision ASHRAE-standard constants — NOT derived
  // from each other or from PA_PER_PSF below (chaining 75/300 Pa through
  // the generic 47.8803 Pa/psf factor gives 1.567/6.269, not the printed
  // 1.57/6.24 — a real, non-negligible mismatch for a page whose labels
  // have to agree with its own math). Selectable in Step 1; these are
  // just the two presets, not immutable constants — a technician whose
  // specimen label cites something else can enter it via "Custom…".
  var LEAKAGE_REF_PRESETS_PSF = { '75': 1.57, '300': 6.24 };

  // Full-precision, general-purpose pressure conversion constants (ASHRAE
  // /engineering standard figures), used only for converting a
  // USER-ENTERED test pressure between units — a separate concern from
  // the rounded E283 reference pressure above.
  var PA_PER_PSF = 47.8803;  // 1 psf = 47.8803 Pa
  var PSF_PER_PSI = 144;     // exact: 1 psi = 144 psf (1 ft^2 = 144 in^2)

  // Inch of water column at the 4°C (39.2°F, water's max-density point)
  // reference convention — the one figure this cross-validated to 5
  // significant figures across four independent sources (Wikipedia plus
  // three unit-conversion references). A 60°F convention gives ~248.843
  // Pa instead (~0.1% lower) — negligible next to a Magnehelic gauge's
  // own ±2% full-scale accuracy, so this single constant is used
  // throughout rather than branching on a convention picker.
  var PA_PER_INWC = 249.089;

  // Blower-count options this calculator models. Only 1 and 2 are offered
  // (matching the field-grid select below) — same reasoning as
  // calculator.js's BOOSTER_ORDER: a small, explicit, documented set
  // rather than an open-ended range.
  var UNIT_OPTIONS = [1, 2];

  /* --------------------------------------------------------------------
     Small helpers — duplicated from calculator.js rather than shared;
     this codebase keeps each page's script self-contained.
     -------------------------------------------------------------------- */

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
     Formulas
     -------------------------------------------------------------------- */

  function specimenAreaFt2(widthFt, heightFt) {
    if (!(widthFt > 0) || !(heightFt > 0)) { return 0; }
    return widthFt * heightFt;
  }

  // Power-law leakage scaling: Q2 = Q1 x (P2/P1)^n. Physically bounded
  // 0.5 <= n <= 1.0 (AIVC Technical Note 44, tracing to LBNL/Sherman
  // research) — 0.5 for fully turbulent/orifice-like paths, 1.0 for
  // fully laminar/crack-like paths. ASTM E779 derives n empirically per
  // test via regression on real multi-point data; it does not itself
  // specify a value, so 0.65 (the Advanced field's default) is borrowed
  // literature, not an E779-native constant — flagged again there.
  function scaledLeakageCfm(q1Cfm, testPressurePsf, refPressurePsf, n) {
    if (!(q1Cfm > 0) || !(testPressurePsf > 0) || !(refPressurePsf > 0)) { return 0; }
    return q1Cfm * Math.pow(testPressurePsf / refPressurePsf, n);
  }

  // Normalizes whichever leakage reference-pressure preset/custom value
  // the user picked in Step 1 down to a single psf figure — same
  // preset-or-custom pattern as getTestPressurePsf() below.
  function getLeakageRefPsf() {
    var sel = $('leakage-ref').value;
    if (sel === 'custom') {
      return num($('leakage-ref-custom').value) || LEAKAGE_REF_PRESETS_PSF['75'];
    }
    return LEAKAGE_REF_PRESETS_PSF[sel] || LEAKAGE_REF_PRESETS_PSF['75'];
  }

  // Normalizes whichever test-pressure path/unit the user picked down to
  // a single internal unit (psf) so every downstream formula only has to
  // handle one case.
  function getTestPressurePsf() {
    var path = $('pressure-path').value;
    if (path === 'dp') {
      var dp = num($('dp-value').value);
      var classFactor = num($('dp-class').value);
      return dp * classFactor;
    }
    var val = num($('direct-value').value);
    var unit = $('direct-unit').value;
    if (unit === 'psi') { return val * PSF_PER_PSI; }
    if (unit === 'pa') { return val / PA_PER_PSF; }
    return val; // already psf
  }

  function magnehelicInWc(testPressurePsf) {
    if (!(testPressurePsf > 0)) { return 0; }
    return (testPressurePsf * PA_PER_PSF) / PA_PER_INWC;
  }

  /* --------------------------------------------------------------------
     Field toggling: same mechanic as calculator.js's initDiameterField
     (a <select> shows/hides a couple of .field blocks via the [hidden]
     attribute — style.css's `.field[hidden] { display: none }` rule
     already exists specifically to make this pattern work).
     -------------------------------------------------------------------- */

  function initPressurePathField() {
    var sel = $('pressure-path');
    var dpFields = [$('dp-value-field'), $('dp-class-field')];
    var directFields = [$('direct-value-field'), $('direct-unit-field')];
    function sync() {
      var isDp = sel.value === 'dp';
      dpFields.forEach(function (el) { el.hidden = !isDp; });
      directFields.forEach(function (el) { el.hidden = isDp; });
    }
    sel.addEventListener('change', function () { sync(); recalculate(); });
    sync();
  }

  function initLeakageRefField() {
    var sel = $('leakage-ref');
    var customField = $('leakage-ref-custom-field');
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
    var widthFt = num($('specimen-width').value);
    var heightFt = num($('specimen-height').value);
    var areaFt2 = specimenAreaFt2(widthFt, heightFt);
    var leakageRate = num($('leakage-rate').value);
    var refPressurePsf = getLeakageRefPsf();

    var path = $('pressure-path').value;
    var dpValue = num($('dp-value').value);
    var dpFactor = num($('dp-class').value);
    var directValue = num($('direct-value').value);
    var directUnit = $('direct-unit').value;

    var testPressurePsf = getTestPressurePsf();
    var testPressurePsi = testPressurePsf / PSF_PER_PSI;
    var testPressurePa = testPressurePsf * PA_PER_PSF;
    var magnehelic = magnehelicInWc(testPressurePsf);

    // Duration has a real default (15 min, ASTM E1105 Procedure A's own
    // minimum) — unlike the blower CFM field below, there's a defensible
    // round number to start from here, so || falls back to it exactly
    // the way calculator.js's hw-c field falls back to 150.
    var durationMin = num($('test-duration').value) || 15;

    var chamberCfm = num($('chamber-margin-cfm').value);
    var leakN = num($('leak-n').value) || 0.65;
    var units = parseInt($('blower-units').value, 10) || 1;
    var perUnitCfm = num($('blower-cfm').value);

    var q1Cfm = leakageRate * areaFt2;
    var q2Cfm = scaledLeakageCfm(q1Cfm, testPressurePsf, refPressurePsf, leakN);
    // Additive, not a percentage of Q2 — chamber/seal leakage and
    // specimen leakage are two independent paths, and per the research
    // behind this page, the chamber term is typically the LARGER of the
    // two, so scaling it off Q2 would understate it. See Step 3's note
    // and the r-required-warning line in render() below.
    var requiredCfm = q2Cfm + chamberCfm;
    var availableCfm = units * perUnitCfm;

    // Deliberately blank-by-default fields (leakage rate, blower CFM —
    // see Steps 1 and 3) mean 0 is a valid "not entered yet" state, not
    // a real answer. Without this guard, a blank blower-CFM field reads
    // as "0 CFM available, insufficient, even 2 units isn't enough"
    // before the technician has entered anything, and a blank leakage
    // rate reads as "0 CFM required, adequate" — both false verdicts.
    var inputsReady = leakageRate > 0 && areaFt2 > 0 &&
      perUnitCfm > 0 && testPressurePsf > 0;

    var isAdequate = inputsReady && availableCfm >= requiredCfm;
    var gapCfm = requiredCfm - availableCfm;

    // Smallest unit count (checked against the RAW per-unit CFM,
    // independent of whichever count happens to be selected right now)
    // that would close the gap on its own. null means even 2 units
    // modeled here isn't enough. Same pattern as calculator.js's
    // neededTier, adapted from booster-psi tiers to blower count.
    var neededUnits = null;
    for (var i = 0; i < UNIT_OPTIONS.length; i++) {
      if (perUnitCfm * UNIT_OPTIONS[i] >= requiredCfm) {
        neededUnits = UNIT_OPTIONS[i];
        break;
      }
    }

    render({
      widthFt: widthFt,
      heightFt: heightFt,
      areaFt2: areaFt2,
      leakageRate: leakageRate,
      refPressurePsf: refPressurePsf,
      path: path,
      dpValue: dpValue,
      dpFactor: dpFactor,
      directValue: directValue,
      directUnit: directUnit,
      testPressurePsf: testPressurePsf,
      testPressurePsi: testPressurePsi,
      testPressurePa: testPressurePa,
      magnehelic: magnehelic,
      durationMin: durationMin,
      chamberCfm: chamberCfm,
      leakN: leakN,
      units: units,
      perUnitCfm: perUnitCfm,
      q1Cfm: q1Cfm,
      q2Cfm: q2Cfm,
      requiredCfm: requiredCfm,
      availableCfm: availableCfm,
      inputsReady: inputsReady,
      isAdequate: isAdequate,
      gapCfm: gapCfm,
      neededUnits: neededUnits
    });
  }

  function render(r) {
    // Hero live stats. requiredCfm is meaningful as soon as a leakage
    // rate and a test pressure exist — independent of whether blower CFM
    // (Step 3) has been entered yet — so it's gated on q1Cfm, not on the
    // broader inputsReady used below for the adequacy verdict. Without
    // this gate, a blank leakage-rate field would show "0 CFM required"
    // as if computed, the same false-zero problem the adequacy panel
    // guards against.
    $('hero-cfm').textContent = r.q1Cfm > 0 ? fmt(r.requiredCfm, 0) : '—';
    $('hero-magnehelic').textContent = fmt(r.magnehelic, 2);
    if (!r.inputsReady) {
      $('hero-status').textContent = '—';
      $('hero-status').style.color = '';
    } else {
      $('hero-status').textContent = r.isAdequate ? 'Adequate' : 'Insufficient';
      $('hero-status').style.color = r.isAdequate ? 'var(--good)' : 'var(--bad)';
    }

    // Target test pressure card
    $('r-testpressure').textContent = fmt(r.testPressurePsf, 2);
    $('r-testpressure-formula').textContent = r.path === 'dp'
      ? 'Test pressure = Design Pressure × class factor (NAFS: 15% for R/LC/CW, 20% for AW)'
      : 'Test pressure = value entered directly, normalized to psf';
    $('r-testpressure-plugged').textContent = r.path === 'dp'
      ? '= ' + fmt(r.dpValue, 1) + ' psf × ' + fmt(r.dpFactor * 100, 0) + '% = ' + fmt(r.testPressurePsf, 2) + ' psf'
      : '= ' + fmt(r.directValue, 2) + ' ' + r.directUnit + ' → ' + fmt(r.testPressurePsf, 2) + ' psf (' +
        fmt(r.testPressurePsi, 3) + ' psi, ' + fmt(r.testPressurePa, 0) + ' Pa)';

    // Q1 — specimen leakage at reference pressure
    $('r-q1').textContent = fmt(r.q1Cfm, 1);
    $('r-q1-plugged').textContent =
      '= ' + fmt(r.leakageRate, 3) + ' × ' + fmt(r.areaFt2, 1) + ' (at P₁ = ' +
      fmt(r.refPressurePsf, 2) + ' psf ref.) = ' + fmt(r.q1Cfm, 1) + ' CFM';

    // Q2 — leakage scaled to test pressure
    $('r-q2').textContent = fmt(r.q2Cfm, 1);
    $('r-q2-plugged').textContent =
      '= ' + fmt(r.q1Cfm, 1) + ' × (' + fmt(r.testPressurePsf, 2) + ' ÷ ' + fmt(r.refPressurePsf, 2) +
      ')^' + fmt(r.leakN, 2) + ' = ' + fmt(r.q2Cfm, 1) + ' CFM';

    // Total required, incl. chamber allowance (additive — see the note
    // in Step 3 on why this isn't a percentage of Q2).
    $('r-required').textContent = fmt(r.requiredCfm, 1);
    $('r-required-plugged').textContent =
      '= ' + fmt(r.q2Cfm, 1) + ' + ' + fmt(r.chamberCfm, 1) + ' = ' + fmt(r.requiredCfm, 1) + ' CFM';
    var warning = $('r-required-warning');
    if (r.q2Cfm > 0 && !(r.chamberCfm > 0)) {
      warning.hidden = false;
      warning.textContent = '⚠ Chamber/seal leakage allowance not yet entered (Step 3) — the ' +
        'figure above reflects specimen leakage only and is very likely an underestimate, ' +
        'since chamber leakage is typically the larger of the two paths.';
    } else {
      warning.hidden = true;
      warning.textContent = '';
    }

    // Total available
    $('r-available').textContent = fmt(r.availableCfm, 1);
    $('r-available-plugged').textContent =
      '= ' + fmt(r.units, 0) + ' × ' + fmt(r.perUnitCfm, 1) + ' = ' + fmt(r.availableCfm, 1) + ' CFM';

    // Magnehelic gauge target
    $('r-magnehelic').textContent = fmt(r.magnehelic, 3);
    $('r-magnehelic-plugged').textContent =
      '= (' + fmt(r.testPressurePsf, 2) + ' × 47.8803) ÷ 249.089 = ' + fmt(r.magnehelic, 3) + ' in. w.c.';

    // Adequacy panel
    var badge = $('adequacy-badge');
    var detail = $('adequacy-detail');
    badge.classList.remove('is-good', 'is-bad');
    if (!r.inputsReady) {
      badge.textContent = 'Enter inputs above to size this test';
      detail.textContent =
        'Provide the specimen leakage rate (Step 1), a target test pressure (Step 2), and the ' +
        'blower\'s rated CFM (Step 3) to compute whether the blower configuration above is adequate.';
    } else if (r.isAdequate) {
      badge.classList.add('is-good');
      badge.textContent = 'Adequate — blower capacity clears the requirement';
      detail.textContent =
        'Available airflow (' + fmt(r.units, 0) + ' unit' + (r.units > 1 ? 's' : '') + ' × ' +
        fmt(r.perUnitCfm, 1) + ' CFM = ' + fmt(r.availableCfm, 1) + ' CFM) clears the ' +
        fmt(r.requiredCfm, 1) + ' CFM required by ' + fmt(Math.abs(r.gapCfm), 1) + ' CFM.';
    } else {
      badge.classList.add('is-bad');
      badge.textContent = 'Insufficient — blower capacity falls short';
      var msg =
        'Available airflow (' + fmt(r.units, 0) + ' unit' + (r.units > 1 ? 's' : '') + ' × ' +
        fmt(r.perUnitCfm, 1) + ' CFM = ' + fmt(r.availableCfm, 1) + ' CFM) falls short of the ' +
        fmt(r.requiredCfm, 1) + ' CFM required by ' + fmt(r.gapCfm, 1) + ' CFM.';
      if (r.neededUnits === null) {
        msg += ' Even 2 blower units at this per-unit rating isn\'t enough on their own — a ' +
          'higher-CFM blower, a tighter chamber seal (lowering the measured chamber allowance ' +
          'in Step 3), or rechecking the leakage-scaling exponent above would all help close ' +
          'the gap.';
      } else {
        // Same reasoning as calculator.js's neededTier branch: this only
        // runs when the CURRENTLY selected count already failed, so
        // neededUnits here is always the strictly larger option (2), never
        // equal to the current selection.
        msg += ' Adding a second blower unit (2 × ' + fmt(r.perUnitCfm, 1) + ' = ' +
          fmt(r.perUnitCfm * 2, 1) + ' CFM) would close the gap on its own.';
      }
      detail.textContent = msg;
    }

    // Printable field-summary checklist — auto-filled from the live
    // calculator so a technician never has to hand-copy these figures.
    $('chk-precheck-units').textContent = fmt(r.units, 0);
    $('chk-precheck-cfm').textContent = fmt(r.availableCfm, 1);
    $('chk-duration').textContent = fmt(r.durationMin, 0);
    $('chk-pressure-psf').textContent = fmt(r.testPressurePsf, 2);
    $('chk-pressure-psi').textContent = fmt(r.testPressurePsi, 3);
    $('chk-pressure-pa').textContent = fmt(r.testPressurePa, 0);
    $('chk-magnehelic').textContent = fmt(r.magnehelic, 3);
    $('chk-refpressure').textContent = fmt(r.refPressurePsf, 2);
    $('chk-refpressure2').textContent = fmt(r.refPressurePsf, 2);
    $('chk-chambercfm').textContent = fmt(r.chamberCfm, 1);
    $('chk-required-cfm').textContent = fmt(r.requiredCfm, 1);
    $('chk-available-cfm').textContent = fmt(r.availableCfm, 1);
    $('chk-units').textContent = fmt(r.units, 0);
    $('chk-percfm').textContent = fmt(r.perUnitCfm, 1);
    $('chk-units-needed').textContent = r.neededUnits === null
      ? 'more than 2 (not modeled above)'
      : fmt(r.neededUnits, 0);
    $('chk-adequacy').textContent = !r.inputsReady
      ? 'not yet computable — inputs incomplete'
      : (r.isAdequate ? 'Adequate' : 'Insufficient');
  }

  /* --------------------------------------------------------------------
     Specimen area — computed live, shown as plain text under Step 1's
     field-grid rather than as a result card (it's an intermediate input
     figure, not a result of the pressure/airflow math below).
     -------------------------------------------------------------------- */

  function updateSpecimenArea() {
    var w = num($('specimen-width').value);
    var h = num($('specimen-height').value);
    $('specimen-area').textContent = fmt(specimenAreaFt2(w, h), 1);
  }

  /* --------------------------------------------------------------------
     Wire up
     -------------------------------------------------------------------- */

  function init() {
    initPressurePathField();
    initLeakageRefField();

    // 'pressure-path' and 'leakage-ref' are deliberately excluded here —
    // each already gets its own change listener from its init*Field()
    // function above (which also has to toggle a companion field's
    // [hidden] state, not just trigger a recalc).
    var fieldIds = [
      'specimen-width', 'specimen-height', 'leakage-rate', 'leakage-ref-custom',
      'dp-value', 'dp-class', 'direct-value', 'direct-unit',
      'test-duration', 'chamber-margin-cfm', 'blower-cfm', 'blower-units',
      'leak-n'
    ];
    fieldIds.forEach(function (id) {
      var el = $(id);
      el.addEventListener('input', recalculate);
      el.addEventListener('change', recalculate);
    });

    var areaFieldIds = ['specimen-width', 'specimen-height'];
    areaFieldIds.forEach(function (id) {
      $(id).addEventListener('input', updateSpecimenArea);
      $(id).addEventListener('change', updateSpecimenArea);
    });

    updateSpecimenArea();
    recalculate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
