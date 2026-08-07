import assert from "node:assert/strict";
import { DEFAULT_SCALE, MAX_SCALE, MIN_SCALE, ZOOM_STEPS, isTheme, nearestStep, zoomIn, zoomOut } from "./preference-constants";

// The zoom ladder is the only thing standing between a user and an app rendered
// at a size they cannot read their way out of, so the ends have to hold and the
// steps have to include the size everything was designed at.
//
//   npx tsx lib/preference-constants.check.ts

function checkLadder() {
  assert.ok(ZOOM_STEPS.includes(DEFAULT_SCALE as (typeof ZOOM_STEPS)[number]), "100% must be a step — it is the size the app was designed at");

  // Ascending and distinct, or zoomIn/zoomOut walk in the wrong direction.
  for (let i = 1; i < ZOOM_STEPS.length; i++) {
    assert.ok(ZOOM_STEPS[i] > ZOOM_STEPS[i - 1], `steps must ascend: ${ZOOM_STEPS[i - 1]} then ${ZOOM_STEPS[i]}`);
  }

  // Every step has to satisfy the database's ui_scale_range check constraint,
  // or a button on the Settings page writes a value the column rejects.
  for (const step of ZOOM_STEPS) {
    assert.ok(step >= 75 && step <= 175, `${step} is outside the ui_scale_range check constraint`);
  }

  console.log(`ok   ladder: ${ZOOM_STEPS.join(", ")} — ascending, includes ${DEFAULT_SCALE}, within the check constraint`);
}

function checkStepping() {
  // Walking up from the bottom reaches the top and stops there.
  let scale: number = MIN_SCALE;
  for (let i = 0; i < ZOOM_STEPS.length * 2; i++) scale = zoomIn(scale);
  assert.equal(scale, MAX_SCALE, "zooming in repeatedly must stop at the largest step");

  for (let i = 0; i < ZOOM_STEPS.length * 2; i++) scale = zoomOut(scale);
  assert.equal(scale, MIN_SCALE, "zooming out repeatedly must stop at the smallest step");

  // One in, one out, back where you started — from every step.
  for (const step of ZOOM_STEPS) {
    if (step !== MAX_SCALE) assert.equal(zoomOut(zoomIn(step)), step, `in then out should return to ${step}`);
    if (step !== MIN_SCALE) assert.equal(zoomIn(zoomOut(step)), step, `out then in should return to ${step}`);
  }

  console.log("ok   stepping: clamps at both ends, reversible in the middle");
}

function checkSnapping() {
  // A value that is not a step lands on the closest one rather than resetting.
  assert.equal(nearestStep(101), 100);
  assert.equal(nearestStep(118), 125);
  assert.equal(nearestStep(-5), MIN_SCALE);
  assert.equal(nearestStep(9999), MAX_SCALE);
  assert.equal(nearestStep(Number.NaN), DEFAULT_SCALE, "an unreadable value falls back to the default, not to the smallest");

  console.log("ok   snapping: off-ladder values land on the nearest step");
}

function checkTheme() {
  assert.ok(isTheme("light"));
  assert.ok(isTheme("dark"));
  assert.ok(!isTheme("system"));
  assert.ok(!isTheme(""));
  assert.ok(!isTheme(undefined));
  console.log("ok   theme guard: accepts light/dark, rejects everything else");
}

function main() {
  checkLadder();
  checkStepping();
  checkSnapping();
  checkTheme();
  console.log("\nall preference constant checks passed");
}

main();
