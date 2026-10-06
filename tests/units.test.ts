import test from "node:test"
import assert from "node:assert/strict"
import {
  KG_PER_LB,
  bodyWeightForViewer,
  bodyWeightToKg,
  cmToFeetInches,
  describePercentLoadFor,
  feetInchesToCm,
  formatHeight,
  formatLoad,
  kgToLb,
  lbToKg,
  loadFieldForViewer,
  loadFieldToStored,
  loadForViewer,
  loadToKg,
  localizeLoadText,
  localizeTargetText,
  markForViewer,
  parseWeightInput,
  percentLoadKg,
  roundToStep,
  rowLoadForViewer,
  weightInputText,
  weightTextToMetric,
} from "../src/lib/units"

test("the conversion constants are the exact definitions", () => {
  assert.equal(KG_PER_LB, 0.45359237)
  assert.equal(feetInchesToCm(0, 1), 2.5) // 2.54 kept to one decimal, as the profile stores height
  assert.ok(Math.abs(kgToLb(lbToKg(225)) - 225) < 1e-9)
  assert.ok(Math.abs(kgToLb(100) - 220.46226218) < 1e-6)
})

test("kilograms are shown as stored, pounds to the nearest half pound", () => {
  assert.equal(loadForViewer(120, "kg"), 120)
  assert.equal(loadForViewer(102.06, "kg"), 102.06)
  assert.equal(loadForViewer(100, "lb"), 220.5)
  assert.equal(loadForViewer(120, "lb"), 264.5)
  assert.equal(loadForViewer(20, "lb"), 44)
  assert.equal(formatLoad(120, "kg"), "120 kg")
  assert.equal(formatLoad(120, "lb"), "264.5 lb")
  assert.equal(roundToStep(121.25, 2.5), 122.5)
  assert.equal(roundToStep(0.25, 0.5), 0.5)
})

test("a load typed in pounds reads back as the same pounds", () => {
  // Every half pound a gym can load, from an empty bar's change plates to a very heavy lift.
  for (let lb = 0.5; lb <= 1200; lb += 0.5) {
    const kg = loadToKg(lb, "lb")
    assert.equal(Number(kg.toFixed(2)), kg, `${lb} lb is stored to two decimals`)
    assert.equal(loadForViewer(kg, "lb"), lb, `${lb} lb round trips`)
  }
  assert.equal(loadToKg(225, "lb"), 102.06)
  assert.equal(loadToKg(45, "lb"), 20.41)
})

test("a load typed in kilograms is stored as typed and reads back the same", () => {
  for (const kg of [20, 42.5, 100, 102.06, 182.5, 300]) {
    assert.equal(loadToKg(kg, "kg"), kg)
    assert.equal(loadForViewer(loadToKg(kg, "kg"), "kg"), kg)
  }
})

test("a percentage of a best lift rounds to 2.5 kg for kilograms and to 5 lb for pounds", () => {
  assert.equal(percentLoadKg(80, 150, "kg"), 120)
  assert.equal(percentLoadKg(77, 152, "kg"), 117.5)
  // 315 lb best: 80% is 252 lb, which is 250 lb on the bar. Not 255 (what converting 115 kg would give).
  const best = lbToKg(315)
  const kg = percentLoadKg(80, best, "lb")
  assert.ok(kg !== null)
  assert.equal(loadForViewer(kg as number, "lb"), 250)
  assert.equal(describePercentLoadFor(80, best, "lb"), "80%, 250 lb")
  assert.equal(describePercentLoadFor(80, 150, "kg"), "80%, 120 kg")
  assert.equal(describePercentLoadFor(80, 150, "lb"), "80%, 265 lb")
  assert.equal(describePercentLoadFor(80, null, "lb"), "80%")
  for (let percent = 40; percent <= 110; percent += 2.5) {
    for (const max of [60, 87.5, 142.88, 200]) {
      const lb = loadForViewer(percentLoadKg(percent, max, "lb") as number, "lb")
      assert.equal(lb % 5, 0, `${percent}% of ${max} kg is a multiple of 5 lb`)
      assert.ok(Math.abs(lb - (kgToLb(max) * percent) / 100) <= 2.5 + 1e-9)
      assert.equal(((percentLoadKg(percent, max, "kg") as number) * 10) % 25, 0)
    }
  }
  assert.equal(percentLoadKg(80, 0, "kg"), null)
  assert.equal(percentLoadKg(null, 100, "lb"), null)
})

test("text naming kilograms is rewritten for pounds and left alone for kilograms", () => {
  assert.equal(localizeLoadText("5 x 100 kg", "kg"), "5 x 100 kg")
  assert.equal(localizeLoadText("5 x 100 kg", "lb"), "5 x 220.5 lb")
  assert.equal(localizeLoadText("3 x 5 at 120kg", "lb"), "3 x 5 at 264.5lb")
  assert.equal(localizeLoadText("5 x 102.06 kg, 4 x 102.06 kg", "lb"), "5 x 225 lb, 4 x 225 lb")
  assert.equal(localizeLoadText("185kg", "lb"), "408lb")
  assert.equal(localizeLoadText("5kg more", "lb"), "11lb more")
  // After a percentage the load is one a bar can carry: nearest 5 lb.
  assert.equal(localizeLoadText("4 x 4 at 80%, 120 kg", "lb"), "4 x 4 at 80%, 265 lb")
  // Track and field marks are never touched.
  assert.equal(localizeLoadText("4.21 s", "lb"), "4.21 s")
  assert.equal(localizeLoadText("7.42m", "lb"), "7.42m")
  assert.equal(localizeLoadText("6 x 200m, 2.75 m", "lb"), "6 x 200m, 2.75 m")
  assert.equal(localizeLoadText(null, "lb"), null)
})

test("a prescription with a bare number after at or @ is a weight", () => {
  assert.equal(localizeTargetText("3 x 5 at 100", "lb"), "3 x 5 at 220.5 lb")
  assert.equal(localizeTargetText("Back squat 4 x 4 @ 100, Bench 3 x 5 @ 60kg", "lb"), "Back squat 4 x 4 @ 220.5 lb, Bench 3 x 5 @ 132.5lb")
  assert.equal(localizeTargetText("4 x 4 at 80%", "lb"), "4 x 4 at 80%")
  assert.equal(localizeTargetText("6 x 200m at 30s", "lb"), "6 x 200m at 30s")
  assert.equal(localizeTargetText("3 x 5 at 100", "kg"), "3 x 5 at 100")
})

test("the plan's load box: typed in the coach's unit, kept metric", () => {
  assert.equal(loadFieldToStored("225", "lb"), "102.06 kg")
  assert.equal(loadFieldToStored("225 lb", "lb"), "102.06 kg")
  assert.equal(loadFieldToStored("132,5lbs", "lb"), "60.1 kg")
  assert.equal(loadFieldForViewer("102.06 kg", "lb"), "225 lb")
  assert.equal(loadFieldForViewer("60.1 kg", "lb"), "132.5 lb")
  // What is not a plain weight is kept as typed: the percentage itself has no unit.
  for (const text of ["80%", "BW", "7.2s", "RPE 8", "100 kg", ""]) assert.equal(loadFieldToStored(text, "lb"), text)
  assert.equal(loadFieldForViewer("80%", "lb"), "80%")
  assert.equal(loadFieldForViewer("BW", "lb"), "BW")
  // A coach on kilograms: nothing is rewritten in either direction.
  for (const text of ["100", "100kg", "80%", "225 lb"]) {
    assert.equal(loadFieldToStored(text, "kg"), text)
    assert.equal(loadFieldForViewer(text, "kg"), text)
  }
  // A kilogram coach's bare "100" is kilograms to a coach on pounds.
  assert.equal(loadFieldForViewer("100", "lb"), "220.5 lb")
  // Every half pound round trips through the box.
  for (let lb = 2.5; lb <= 700; lb += 2.5) assert.equal(loadFieldForViewer(loadFieldToStored(String(lb), "lb"), "lb"), `${lb} lb`)
})

test("a row's target for the reader, and what 'same as target' then stores", () => {
  const plain = { target: "3 x 5 at 100kg", targetLoad: "100kg", percent: null }
  assert.deepEqual(rowLoadForViewer(plain, "kg"), { target: "3 x 5 at 100kg", targetLoad: "100kg" })
  // The line is read in pounds; what "same as target" stores is still exactly 100 kg.
  assert.deepEqual(rowLoadForViewer(plain, "lb"), { target: "3 x 5 at 220.5lb", targetLoad: "100kg" })
  assert.deepEqual(rowLoadForViewer({ target: "3 x 5 at 100", targetLoad: "100" }, "lb"), { target: "3 x 5 at 220.5 lb", targetLoad: "100" })

  const percent = { target: "4 x 4 at 80%, 115 kg", targetLoad: "115 kg", percent: 80 }
  // With the best lift known (315 lb): worked out again in pounds, and the bar's 250 lb is what is stored.
  assert.deepEqual(rowLoadForViewer(percent, "lb", lbToKg(315)), { target: "4 x 4 at 80%, 250 lb", targetLoad: "113.4 kg" })
  assert.equal(loadForViewer(113.4, "lb"), 250)
  // Without it: the kilogram load converted to the nearest 5 lb, shown and stored alike.
  assert.deepEqual(rowLoadForViewer(percent, "lb"), { target: "4 x 4 at 80%, 255 lb", targetLoad: "115.67 kg" })
  assert.equal(loadForViewer(115.67, "lb"), 255)
  assert.deepEqual(rowLoadForViewer(percent, "kg", lbToKg(315)), { target: percent.target, targetLoad: percent.targetLoad })
  // No best lift saved: the bare percentage stays.
  assert.deepEqual(rowLoadForViewer({ target: "4 x 4 at 80%", targetLoad: "80%", percent: 80 }, "lb"), { target: "4 x 4 at 80%", targetLoad: "80%" })
})

test("kilogram results (strength tests, best lifts) for the reader", () => {
  assert.deepEqual(markForViewer("185", "kg", "lb"), { value: "408", unit: "lb" })
  assert.deepEqual(markForViewer("185", "kg", "kg"), { value: "185", unit: "kg" })
  assert.deepEqual(markForViewer("7.42", "m", "lb"), { value: "7.42", unit: "m" })
  assert.deepEqual(markForViewer("10.84", "s", "lb"), { value: "10.84", unit: "s" })
  assert.equal(weightInputText(142.88, "lb"), "315")
  assert.equal(weightInputText(142.88, "kg"), "142.88")
  assert.equal(parseWeightInput("315", "lb"), 142.88)
  assert.equal(parseWeightInput("315 lb", "lb"), 142.88)
  assert.equal(parseWeightInput("120 kg", "kg"), 120)
  assert.equal(parseWeightInput("122,5", "kg"), 122.5)
  assert.equal(parseWeightInput("120 lb", "kg"), null)
  assert.equal(parseWeightInput("heavy", "lb"), null)
  assert.equal(weightTextToMetric("405", "lb"), "183.7")
  assert.equal(weightTextToMetric("405", "kg"), "405")
  assert.equal(weightTextToMetric("abc", "lb"), "abc")
  for (let lb = 5; lb <= 1000; lb += 2.5) assert.equal(weightInputText(parseWeightInput(String(lb), "lb") as number, "lb"), String(lb))
})

test("body height in feet and inches, body weight in pounds", () => {
  assert.deepEqual(cmToFeetInches(180), { feet: 5, inches: 11 })
  assert.deepEqual(cmToFeetInches(182.88), { feet: 6, inches: 0 })
  assert.deepEqual(cmToFeetInches(152.3), { feet: 5, inches: 0 }) // never "4 ft 12 in"
  assert.equal(formatHeight(180, "cm"), "180 cm")
  assert.equal(formatHeight(180, "ft_in"), "5 ft 11 in")
  assert.equal(formatHeight(179, "ft_in"), "5 ft 10.5 in")
  assert.equal(feetInchesToCm(5, 11), 180.3)
  // Every half inch a person can be reads back the same after being stored to 0.1 cm.
  for (let inches = 36; inches <= 96; inches += 0.5) {
    const feet = Math.floor(inches / 12)
    assert.deepEqual(cmToFeetInches(feetInchesToCm(feet, inches - feet * 12)), { feet, inches: inches - feet * 12 })
  }
  assert.equal(bodyWeightForViewer(75, "lb"), 165.5)
  assert.equal(bodyWeightForViewer(75, "kg"), 75)
  assert.equal(bodyWeightToKg(165.5, "lb"), 75.1)
  assert.equal(bodyWeightToKg(75, "kg"), 75)
  // Every half pound reads back the same after being stored to 0.1 kg.
  for (let lb = 60; lb <= 400; lb += 0.5) assert.equal(bodyWeightForViewer(bodyWeightToKg(lb, "lb"), "lb"), lb)
})
