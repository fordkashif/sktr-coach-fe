import test from "node:test"
import assert from "node:assert/strict"
import { parseInviteList } from "../src/lib/data/invites/invite-list"
import { encodeQr } from "../src/lib/qr/qr-encode"

test("invite list: plain emails, names, angle brackets, duplicates and bad lines", () => {
  const lines = parseInviteList(["Maya@Example.com", "Jordan Reid, jordan@example.com", "Tia Brooks <tia@example.com>", "", "not an email", "maya@example.com", "sam@example", "kim@example.com; Kim Lee"].join("\n"))
  assert.deepEqual(
    lines.map((line) => [line.line, line.email, line.name, line.valid]),
    [
      [1, "maya@example.com", null, true],
      [2, "jordan@example.com", "Jordan Reid", true],
      [3, "tia@example.com", "Tia Brooks", true],
      [5, "", "not an email", false],
      [6, "maya@example.com", null, false],
      [7, "sam@example", null, false],
      [8, "kim@example.com", "Kim Lee", true],
    ],
  )
  assert.equal(lines[4].problem, "Same email as a line above")
})

test("invite list: CSV with a header, columns in any order, quoted cells", () => {
  const lines = parseInviteList('Last name,Email,First name,Club\r\n"Reid",jordan@example.com,Jordan,Elite\r\nChen,MAYA@example.com,"Maya",Elite\r\n')
  assert.deepEqual(
    lines.map((line) => [line.email, line.name, line.valid]),
    [
      ["jordan@example.com", "Jordan Reid", true],
      ["maya@example.com", "Maya Chen", true],
    ],
  )
  const named = parseInviteList('name,email\n"Okafor, David",david@example.com')
  assert.deepEqual([named[0].email, named[0].name], ["david@example.com", "Okafor, David"])
})

test("invite list: nothing that looks like markup or a second address is accepted as an email", () => {
  for (const raw of ["<script>@x.y", "a@b.c,d@e.f extra@", "a b@c.d e"]) {
    const [line] = parseInviteList(raw)
    assert.ok(!line.valid || /^[^\s<>",;]+@[^\s<>",;]+$/.test(line.email), raw)
  }
})

test("QR code: sizes, finder patterns and the length limit", () => {
  const small = encodeQr("A")
  assert.equal(small.version, 1)
  assert.equal(small.size, 21)
  const link = encodeQr("https://app.example.com/join/0123456789abcdef0123456789abcdef")
  assert.equal(link.size, link.version * 4 + 17)
  assert.ok(link.version >= 4 && link.version <= 6)
  // The three finder patterns: a dark 7x7 ring with a dark 3x3 centre.
  for (const [x, y] of [[0, 0], [link.size - 7, 0], [0, link.size - 7]]) {
    assert.ok(link.modules[y][x] && link.modules[y + 6][x + 6] && link.modules[y + 3][x + 3])
    assert.ok(!link.modules[y + 1][x + 1] && !link.modules[y + 5][x + 5])
  }
  assert.deepEqual(encodeQr("same").modules, encodeQr("same").modules)
  assert.throws(() => encodeQr("x".repeat(214)))
})
