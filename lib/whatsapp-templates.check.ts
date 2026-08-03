import assert from "node:assert/strict";
import { normalizePhone, renderTemplate, waMeLink } from "./whatsapp-templates";

// Phone normalisation is the part that quietly loses messages — a number off by
// one leading zero is delivered to nobody and reported as sent. No database
// needed:
//
//   npx tsx lib/whatsapp-templates.check.ts

// --- Local Pakistani forms ---------------------------------------------------
assert.equal(normalizePhone("0300-1234567"), "923001234567");
assert.equal(normalizePhone("0300 1234567"), "923001234567");
assert.equal(normalizePhone("03001234567"), "923001234567");
assert.equal(normalizePhone("(0321) 998-8776"), "923219988776");

// --- Already international ---------------------------------------------------
assert.equal(normalizePhone("+923001234567"), "923001234567");
assert.equal(normalizePhone("00923001234567"), "923001234567");
assert.equal(normalizePhone("923001234567"), "923001234567");
// A foreign supplier's number keeps its own country code rather than being
// re-prefixed with 92.
assert.equal(normalizePhone("+49-711-4000000"), "497114000000");

// --- Not a number ------------------------------------------------------------
assert.equal(normalizePhone(""), null);
assert.equal(normalizePhone("n/a"), null);
assert.equal(normalizePhone("12345"), null, "too short to be a mobile number");
assert.equal(normalizePhone("+1234567890123456789"), null, "too long for E.164");

// --- Country code is configurable, not baked in ------------------------------
assert.equal(normalizePhone("0712345678", "44"), "44712345678");

// --- Templates: the facts have to survive into the text ----------------------
const invoice = renderTemplate("invoice", {
  companyName: "Royal Hardware",
  recipientName: "Ahmed Furniture",
  documentNumber: "SI-0042",
  amount: "PKR 38,600.0",
  balance: "PKR 12,600.0",
  date: "25-12-2026",
});
assert.match(invoice, /SI-0042/);
assert.match(invoice, /38,600/);
assert.match(invoice, /Balance outstanding/, "an unpaid invoice has to say so");
assert.match(invoice, /Royal Hardware$/);

// A settled invoice says thank you rather than quoting a zero balance.
const paid = renderTemplate("invoice", {
  companyName: "Royal Hardware",
  recipientName: "Ahmed Furniture",
  documentNumber: "SI-0043",
  amount: "PKR 4,200.0",
  balance: "PKR 0.0",
  date: "25-12-2026",
});
assert.doesNotMatch(paid, /Balance outstanding/);
assert.match(paid, /Paid in full/);

const quotation = renderTemplate("quotation", {
  companyName: "M52",
  recipientName: "Bilal Builders",
  documentNumber: "QT-0007",
  amount: "PKR 210,000.0",
  date: "01-12-2026",
  validUntil: "20-12-2026",
});
assert.match(quotation, /QT-0007/);
assert.match(quotation, /Valid until: 20-12-2026/);

// A quotation with no expiry simply doesn't mention one.
assert.doesNotMatch(renderTemplate("quotation", { companyName: "M52", recipientName: "X", documentNumber: "QT-1", amount: "1", date: "d" }), /Valid until/);

// Custom is exactly what was typed, trimmed — no greeting, no signature bolted on.
assert.equal(renderTemplate("custom", { companyName: "RH", recipientName: "X", body: "  Stock is in.  " }), "Stock is in.");

// --- Click-to-chat links -----------------------------------------------------
// The free send path. Anything wrong here opens a chat with the wrong person or
// with the message mangled, and it is a person who then presses send.
const link = waMeLink("0300-1234567", "Hello Ahmed");
assert.equal(link, "https://wa.me/923001234567?text=Hello%20Ahmed");
// Spaces must be %20, not "+": WhatsApp shows a "+" literally in the box.
assert.doesNotMatch(link!, /\+/);

// Newlines and the * WhatsApp uses for bold survive the round trip.
const multi = waMeLink("+923001234567", "*Invoice SI-0042*\nTotal: PKR 5,000");
assert.equal(decodeURIComponent(multi!.split("?text=")[1]), "*Invoice SI-0042*\nTotal: PKR 5,000");

// & and # would otherwise truncate or fragment the URL.
assert.equal(decodeURIComponent(waMeLink("03001234567", "A & B #1")!.split("?text=")[1]), "A & B #1");

// A number that can't be normalised gets no link at all, rather than one that
// opens an empty chat with nobody.
assert.equal(waMeLink("", "hi"), null);
assert.equal(waMeLink("abc", "hi"), null);
assert.equal(waMeLink("12", "hi"), null);

console.log("whatsapp template checks passed");
