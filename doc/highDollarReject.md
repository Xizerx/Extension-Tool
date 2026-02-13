

# High Dollar Reject Guard (Browser Content Script)

## Overview

**High Dollar Reject Guard** is a client-side content script that intercepts **Reject** actions on repair order line items whose **Total Cost exceeds $20,000**, and requires the reviewer to confirm whether the rejection represents:

* **Valid** cost savings
* **Input Error** (e.g., pricing entered incorrectly)

If the user selects **Input Error**, the script automatically:

* Sets **Rejection Reason = Other**
* Prefills the **Notes** field with a standardized message
* Unchecks the **Cost Saving** checkbox

This feature reduces accidental misclassification of cost savings, improves auditability, and standardizes communication.

---

## Goals

* Prevent accidental **Reject** actions on high-dollar items without explicit confirmation
* Standardize rejection reason and notes for pricing mistakes
* Ensure the **Cost Saving** flag is not incorrectly left enabled when rejection is due to input errors
* Provide a non-intrusive flow that preserves existing app behavior

---

## Non-Goals

* Replacing the app’s native rejection workflow
* Server-side validation or enforcement
* Automated submission of the rejection form (left optional / disabled by default)

---

## Behavior Summary

### Trigger Condition

The script activates **only** when:

* A user clicks a button identified as **Reject**
* The detected line item **Total Cost** is **greater than $20,000**

---

### Intercepted Flow

When triggered:

1. The click event is intercepted in the **capture phase** (before React handlers execute)
2. A full-screen overlay appears displaying:

   * Detected Total Cost
   * Context about the $20K threshold
   * Two action buttons: **Valid** and **Input Error**

---

### User Choice

#### 1) Valid

* Proceeds with normal Reject behavior
* No form automation occurs
* Implementation: programmatically re-clicks the original Reject button using a bypass guard

#### 2) Input Error

* Opens the native rejection dialog
* Runs automation that:

  * Selects **Rejection Reason: Other**
  * Prefills the **Notes** field
  * Unchecks **Cost Saving**

---

## Technical Design

### File Location

```
content/highDollarRejectGuard.js
```

---

### Threshold Configuration

```js
const THRESHOLD = 20000;
```

Modify this value to adjust the high-dollar trigger amount.

---

## High-Level Flow

1. Capture click events globally
2. Detect if the target is a **Reject** button
3. Read the line item total within the nearest relevant DOM scope
4. If total exceeds threshold:

   * Stop propagation
   * Display confirmation overlay
5. On confirmation:

   * **Valid** → proceed normally
   * **Input Error** → proceed + automate dialog fields

---

## DOM Integration Details

### Reject Button Detection

The script identifies the Reject button by:

* Using `closest("button")`
* Matching `textContent` for `"Reject"` (case-insensitive)

---

### Line Item Scope Detection

To avoid reading totals from unrelated items, the script scopes queries to the nearest container such as:

* `.MuiPaper-root`
* `.MuiCard-root`
* Common `section` or `article` containers

---

### Total Cost Detection

Primary selector (based on observed DOM):

```css
span[aria-describedby*="totalCost"]
```

Money strings are parsed into floats:

```
"$29,999.99" → 29999.99
```

---

## Input Error Automation

### Why This Was Hard

The rejection dialog and its fields render asynchronously in React / MUI environments:

* `<select>` options may not exist immediately
* MUI selects may not be native `<select>` elements (combobox + portal menu)
* React-controlled inputs do not reliably update from direct property assignment (`.checked = false`, `.value = x`) unless proper events are dispatched

---

## Stability Fix Strategy

The automation uses a **Wait → Retry → Fallback → Dispatch** pattern.

---

### 1) Wait for Dialog and Controls

The script waits until:

* A dialog appears (`div[role="dialog"]`)
* It contains interactive controls:

  * `select`
  * `textarea`
  * `input`
  * MUI combobox triggers

---

### 2) Wait for `<select>` Options

For native selects, it waits until:

```js
select.options.length > 0
```

---

### 3) Retry Selection

Selection is attempted multiple times due to asynchronous rendering:

* 3–4 attempts
* 200–300ms delay between attempts

---

### 4) Fallback Selection Strategies

Selection attempts include:

1. Match by visible text: `"Other"`
2. Regex match: `/\bother\b/i`
3. Match by option value: `value="6"`
4. Fallback to known index: `nth-child(13)` → index `12`

---

### 5) Dispatch React-Friendly Events

After programmatic changes, the script dispatches:

* `input`
* `change`

With:

```js
{ bubbles: true, composed: true }
```

This ensures React state updates properly.

---

## Checkbox Handling (Cost Saving)

### Root Cause

The **Cost Saving** checkbox is React-controlled. Direct assignment:

```js
cb.checked = false;
```

may not update application state.

---

### Fix

The script toggles using:

```js
cb.click();
```

This triggers proper React event handling.

---

## Notes Prefill

### Standardized Message

The Notes field is populated with:

> It appears this dollar amount was entered in error, please review and adjust the dollar amount and resubmit. Thank you.

Supported input types:

* `<textarea>`
* `<input type="text">`
* Fallback textbox selectors

---

## Accessibility Considerations

The overlay is created as an accessible dialog:

* `role="dialog"`
* `aria-modal="true"`
* Focus automatically set to the first action button for keyboard navigation

---

## Safety / Guardrails

### Bypass Guard (Recursion Prevention)

A `_bypassOnce` flag prevents re-triggering the overlay when the script programmatically re-clicks the Reject button.

---

### No Auto-Submit by Default

The script **does not automatically submit** the rejection dialog.

This preserves user control and avoids unintended submissions.

Optional auto-submit code exists but is commented out.

---

## Configuration & Customization

### Change the Threshold

```js
const THRESHOLD = 20000;
```

---

### Enable Auto-Submit (Optional)

Uncomment inside the automation function:

```js
// const submitBtn = findDialogRejectSubmitButton(dialog);
// if (submitBtn) submitBtn.click();
```

---

### Change the Prefill Message

Modify the string passed to the notes field population function.

---

## Debugging

### Console Logs

The script uses `console.debug` to log:

* Dialog detection
* Select option population
* Selected option (value/text)
* Retry attempts

---

### Suggested Debugging Steps

1. Open DevTools Console
2. Trigger overlay by rejecting a high-dollar line
3. Choose **Input Error**
4. Observe logs for:

   * Dialog detection
   * Select option population
   * Successful selection path

---

## Testing Checklist

### High-Dollar Cases

* [ ] Reject line item > $20,000 triggers overlay
* [ ] “Valid” proceeds without automation
* [ ] “Input Error” opens dialog and:

  * [ ] Selects Reason = Other
  * [ ] Prefills Notes
  * [ ] Unchecks Cost Saving

---

### Non-High-Dollar Cases

* [ ] Reject line item ≤ $20,000 proceeds normally (no overlay)

---

### Regression / Stability

* [ ] Works when dialog loads slowly
* [ ] Works when select options mount late
* [ ] Works if MUI select uses portal listbox

---

## Known Limitations

* DOM selectors depend on current UI structure (MUI classnames + IDs). UI changes may require selector updates.
* If multiple dialogs exist simultaneously, `div[role="dialog"]` may become ambiguous.
* If “Other” label changes (e.g., localization), the matcher must be updated.

---

## Change Log

### v1 (Initial)

* Overlay gating works
* Basic selection attempted via `.value = ...`

---

### v2 (Stability Fixes)

* Added async readiness checks (dialog + controls)
* Added `<select>` options wait logic
* Added retry loops with delays
* Added robust selection fallbacks (text/value/index)
* Fixed checkbox handling via `.click()`
* Added React-friendly event dispatching

---

## Maintenance Notes

If selection fails in the future:

1. Confirm whether the UI uses:

   * Native `<select>`
   * MUI combobox
2. Update select trigger selector or option lookup logic
3. Verify the following elements still exist:

   * `select#roItemRejectionReasonId`
   * `option value="6"` still maps to **Other**
   * `input#isCostSaving`

---
