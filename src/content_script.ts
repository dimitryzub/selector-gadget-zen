let ui: HTMLElement | null = null;
let selectorInput: HTMLInputElement | null = null;
let modeToggle: HTMLInputElement | null = null;
let isPicking = false;

// State for the refined selection logic, renamed to match SelectorGadget's concepts
let selectedElements: HTMLElement[] = [];
let rejectedElements: HTMLElement[] = [];
let lastHovered: HTMLElement | null = null;
let lastCssSelector: string | null = null;

// The prediction engine, ported from the original SelectorGadget
let predictionHelper: DomPredictionHelper;
// Elements that should never be selected
let restrictedElements: HTMLElement[];


// --- Start of ported SelectorGadget core logic ---

/**
 * Diff Match and Patch
 * Copyright 2018 The diff-match-patch Authors.
 * https://github.com/google/diff-match-patch
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Define an interface for the diff_match_patch instance
interface IDiffMatchPatch {
  Diff_Timeout: number;
  Diff_EditCost: number;
  Match_Threshold: number;
  Match_Distance: number;
  Patch_DeleteThreshold: number;
  Patch_Margin: number;
  Match_MaxBits: number;
  diff_main(text1: string, text2: string): [number, string][];
  diff_linesToChars_(text1: string, text2: string): { chars1: string; chars2: string; lineArray: string[] };
  diff_charsToLines_(diffs: [number, string][], lineArray: string[]): void;
}

var diff_match_patch = function(this: IDiffMatchPatch) {
  this.Diff_Timeout = 1.0;
  this.Diff_EditCost = 4;
  this.Match_Threshold = 0.5;
  this.Match_Distance = 1000;
  this.Patch_DeleteThreshold = 0.5;
  this.Patch_Margin = 4;
  this.Match_MaxBits = 32;
};
diff_match_patch.prototype.diff_main = function(this: IDiffMatchPatch, text1: string, text2: string): [number, string][] {
  var dmp = this;
  var a = dmp.diff_linesToChars_(text1, text2);
  var linearray = a.lineArray;
  // The original JS library uses an internal version of diff_main with more arguments.
  // We cast to any to allow this internal call without complex type definitions.
  var diffs = (dmp as any).diff_main(a.chars1, a.chars2, false);
  dmp.diff_charsToLines_(diffs, linearray);
  return diffs;
};
diff_match_patch.prototype.diff_linesToChars_ = function(this: IDiffMatchPatch, text1: string, text2: string) {
  var lineArray: string[] = [];
  var lineHash: { [key: string]: number } = {};
  lineArray[0] = '';
  function diff_linesToCharsMunge_(text: string) {
    var chars = '';
    var lineStart = 0;
    var lineEnd = -1;
    var lineArrayLength = lineArray.length;
    while (lineEnd < text.length - 1) {
      lineEnd = text.indexOf('\n', lineStart);
      if (lineEnd == -1) {
        lineEnd = text.length - 1;
      }
      var line = text.substring(lineStart, lineEnd + 1);
      if (lineHash.hasOwnProperty(line)) {
        chars += String.fromCharCode(lineHash[line]);
      } else {
        if (lineArrayLength == maxLines) {
          line = text.substring(lineStart);
          lineEnd = text.length;
        }
        chars += String.fromCharCode(lineArrayLength);
        lineHash[line] = lineArrayLength;
        lineArray[lineArrayLength++] = line;
      }
      lineStart = lineEnd + 1;
    }
    return chars;
  }
  var maxLines = 40000;
  var chars1 = diff_linesToCharsMunge_(text1);
  maxLines = 65535;
  var chars2 = diff_linesToCharsMunge_(text2);
  return {chars1: chars1, chars2: chars2, lineArray: lineArray};
};
diff_match_patch.prototype.diff_charsToLines_ = function(this: IDiffMatchPatch, diffs: [number, string][], lineArray: string[]) {
  for (var i = 0; i < diffs.length; i++) {
    var chars = diffs[i][1];
    var text: string[] = [];
    for (var j = 0; j < chars.length; j++) {
      text[j] = lineArray[chars.charCodeAt(j)];
    }
    diffs[i][1] = text.join('');
  }
};

/**
 * A class for generating CSS selectors from selected and rejected elements.
 * Ported from the original CoffeeScript source of SelectorGadget.
 */
class DomPredictionHelper {
  constructor() {}

  recursiveNodes(e: Element): Element[] {
    if (e.parentNode && e.nodeName && e.parentNode.nodeName && e !== document.body) {
      const n = this.recursiveNodes(e.parentNode as Element);
      n.push(e);
      return n;
    } else {
      return [e];
    }
  }

  escapeCssNames(name: string): string {
    if (name) {
      try {
        // This is the corrected line. It now looks for `sg-` instead of `selectorgadget_`.
        return name.replace(/\bsg-\w+\b/g, '')
                   .replace(/\\/g, '\\\\')
                   .replace(/[\#\;\&\,\.\+\*\~\'\:\"\!\^\$\[\]\(\)\=\>\|\/]/g, (e) => '\\' + e)
                   .replace(/\s+/, '');
      } catch (e) {
        if (window.console) {
          console.log('---');
          console.log("exception in escapeCssNames");
          console.log(name);
          console.log('---');
        }
        return '';
      }
    } else {
      return '';
    }
  }

  childElemNumber(elem: Element): number {
    let count = 0;
    let sibling = elem.previousSibling;
    while (sibling) {
      if (sibling.nodeType === 1) {
        count++;
      }
      sibling = sibling.previousSibling;
    }
    return count;
  }

  siblingsWithoutTextNodes(e: Element): Element[] {
    const nodes = e.parentNode!.childNodes;
    const filtered_nodes: Element[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.nodeName.substring(0, 1) === "#" || !(node instanceof Element)) {
        continue;
      }
      if (node === e) {
        break;
      }
      filtered_nodes.push(node);
    }
    return filtered_nodes;
  }

  pathOf(elem: Element): string {
    let path = "";
    const recursiveNodes = this.recursiveNodes(elem);
    for (const e of recursiveNodes) {
      if (e) {
        const siblings = this.siblingsWithoutTextNodes(e);
        if (e.nodeName.toLowerCase() !== "body") {
          let j = siblings.length - 2 < 0 ? 0 : siblings.length - 2;
          while (j < siblings.length) {
            if (siblings[j] === e) break;
            if (!siblings[j].nodeName.match(/^(script|#.*?)$/i)) {
              path += this.cssDescriptor(siblings[j]) + (j + 1 === siblings.length ? "+ " : "~ ");
            }
            j++;
          }
        }
        path += this.cssDescriptor(e) + " > ";
      }
    }
    return this.cleanCss(path);
  }

  cssDescriptor(node: Element): string {
    let path = node.nodeName.toLowerCase();
    const id = node.getAttribute('id');
    if (id) {
      const escaped = this.escapeCssNames(id);
      if (escaped && escaped.length > 0) {
        path += '#' + escaped;
      }
    }

    const className = node.getAttribute('class');
    if (className) {
      for (const cssName of className.split(" ")) {
        const escaped = this.escapeCssNames(cssName);
        if (cssName && escaped.length > 0) {
          path += '.' + escaped;
        }
      }
    }

    if (node.nodeName.toLowerCase() !== "body") {
      path += ':nth-child(' + (this.childElemNumber(node) + 1) + ')';
    }

    return path;
  }

  cssDiff(array: string[]): string {
    const dmp = new (diff_match_patch as any)();
    if (typeof array === 'undefined' || array.length === 0) return '';

    const existing_tokens: { [key: string]: string } = {};
    const encoded_css_array = this.encodeCssForDiff(array, existing_tokens);

    let collective_common = encoded_css_array.pop()!;
    for (const cssElem of encoded_css_array) {
      const diff = dmp.diff_main(collective_common, cssElem);
      collective_common = '';
      for (const part of diff) {
        if (part[0] === 0) {
          collective_common += part[1];
        }
      }
    }
    return this.decodeCss(collective_common, existing_tokens);
  }

  tokenizeCss(css_string: string): string[] {
    let skip = false;
    let word = '';
    const tokens: string[] = [];

    for (const char of this.cleanCss(css_string)) {
      if (skip) {
        skip = false;
      } else if (char === '\\') {
        skip = true;
      } else if (['.', ' ', '#', '>', ':', ',', '+', '~'].includes(char)) {
        if (word.length > 0) tokens.push(word);
        word = '';
      }
      word += char;
      if (char === ' ' || char === ',') {
        tokens.push(word);
        word = '';
      }
    }
    if (word.length > 0) tokens.push(word);
    return tokens;
  }

  tokenizeCssForDiff(css_string: string): string[] {
    let combined_tokens: string[] = [];
    let block: string[] = [];

    for (const token of this.tokenizeCss(css_string)) {
      block.push(token);
      if (token === ' ' && block.length > 0) {
        combined_tokens = combined_tokens.concat(block);
        block = [];
      } else if (token === '+' || token === '~') {
        block = [block.join('')];
      }
    }
    return block.length > 0 ? combined_tokens.concat(block) : combined_tokens;
  }

  decodeCss(string: string, existing_tokens: { [key: string]: string }): string {
    const inverted = this.invertObject(existing_tokens);
    let out = '';
    for (const character of string.split('')) {
      out += inverted[character];
    }
    return this.cleanCss(out);
  }

  encodeCssForDiff(strings: string[], existing_tokens: { [key: string]: string }): string[] {
    let codepoint = 50;
    const strings_out: string[] = [];
    for (const string of strings) {
      let out = "";
      for (const token of this.tokenizeCssForDiff(string)) {
        if (!existing_tokens[token]) {
          existing_tokens[token] = String.fromCharCode(codepoint++);
        }
        out += existing_tokens[token];
      }
      strings_out.push(out);
    }
    return strings_out;
  }

  tokenPriorities(tokens: string[]): number[] {
    const epsilon = 0.001;
    const priorities: number[] = [];
    let i = 0;
    for (const token of tokens) {
      const first = token.substring(0, 1);
      const second = token.substring(1, 2);
      if (first === ':' && second === 'n') { // :nth-child
        priorities[i] = 0;
      } else if (first === '>') { // >
        priorities[i] = 2;
      } else if (first === '+' || first === '~') { // + and ~
        priorities[i] = 3;
      } else if (![':', '.', '#', ' ', '>', '+', '~'].includes(first)) { // elem, etc.
        priorities[i] = 4;
      } else if (first === '.') { // classes
        priorities[i] = 5;
      } else if (first === '#') { // ids
        priorities[i] = 6;
        if (token.match(/\d{3,}/)) {
          priorities[i] = 2.5;
        }
      } else {
        priorities[i] = 0;
      }
      priorities[i] += i * epsilon;
      i++;
    }
    return priorities;
  }

  orderFromPriorities(priorities: number[]): number[] {
    const tmp: { value: number, original: number }[] = [];
    const ordering: number[] = [];
    for (let i = 0; i < priorities.length; i++) {
      tmp[i] = { value: priorities[i], original: i };
    }
    tmp.sort((a, b) => a.value - b.value);
    for (let i = 0; i < priorities.length; i++) {
      ordering[i] = tmp[i].original;
    }
    return ordering;
  }

  simplifyCss(css: string, selected: HTMLElement[], rejected: HTMLElement[]): string {
    const parts = this.tokenizeCss(css);
    const priorities = this.tokenPriorities(parts);
    const ordering = this.orderFromPriorities(priorities);
    const selector = this.cleanCss(css);
    let best_so_far = "";

    if (this.selectorGets('all', selected, selector) && this.selectorGets('none', rejected, selector)) {
      best_so_far = selector;
    }

    let got_shorter = true;
    while (got_shorter) {
      got_shorter = false;
      for (let i = 0; i < parts.length; i++) {
        const part_index = ordering[i];
        if (parts[part_index].length === 0) continue;

        const first = parts[part_index].substring(0, 1);
        if (first === ' ') continue;
        if (this.wouldLeaveFreeFloatingNthChild(parts, part_index)) continue;

        this._removeElements(part_index, parts, first, (newSelector) => {
          if (this.selectorGets('all', selected, newSelector) && this.selectorGets('none', rejected, newSelector) &&
             (newSelector.length < best_so_far.length || best_so_far.length === 0)) {
            best_so_far = newSelector;
            got_shorter = true;
            return true;
          } else {
            return false;
          }
        });
      }
    }
    return this.cleanCss(best_so_far);
  }

  _removeElements(part_index: number, parts: string[], firstChar: string, callback: (selector: string) => boolean): void {
    const look_back_index = (firstChar === '+' || firstChar === '~') ? this.positionOfSpaceBeforeIndexOrLineStart(part_index, parts) : part_index;

    const tmp = parts.slice(look_back_index, part_index + 1);
    for (let j = look_back_index; j <= part_index; j++) {
      parts[j] = '';
    }

    const selector = this.cleanCss(parts.join(''));

    if (selector === '' || !callback(selector)) {
      for (let j = look_back_index; j <= part_index; j++) {
        parts[j] = tmp[j - look_back_index];
      }
    }
  }

  positionOfSpaceBeforeIndexOrLineStart(part: number, parts: string[]): number {
    let i = part;
    while (i >= 0 && parts[i] !== ' ') {
      i--;
    }
    return i < 0 ? 0 : i;
  }

  wouldLeaveFreeFloatingNthChild(parts: string[], part_index: number): boolean {
    let space_is_on_left = false, nth_child_is_on_right = false;

    let i = part_index + 1;
    while (i < parts.length && parts[i].length === 0) i++;
    if (i < parts.length && parts[i].substring(0, 2) === ':n') nth_child_is_on_right = true;

    i = part_index - 1;
    while (i > -1 && parts[i].length === 0) i--;
    if (i < 0 || parts[i] === ' ') space_is_on_left = true;

    return space_is_on_left && nth_child_is_on_right;
  }

  cleanCss(css: string): string {
    let cleaned_css = css;
    let last_cleaned_css = null;
    while (last_cleaned_css !== cleaned_css) {
      last_cleaned_css = cleaned_css;
      cleaned_css = cleaned_css.replace(/(^|\s+)(\+|\~)/, '').replace(/(\+|\~)\s*$/, '').replace(/>/g, ' > ')
                               .replace(/\s*(>\s*)+/g, ' > ').replace(/,/g, ' , ').replace(/\s+/g, ' ')
                               .replace(/^\s+|\s+$/g, '').replace(/\s*,$/g, '').replace(/^\s*,\s*/g, '').replace(/\s*>$/g, '')
                               .replace(/^>\s*/g, '').replace(/[\+\~\>]\s*,/g, ',').replace(/[\+\~]\s*>/g, '>').replace(/\s*(,\s*)+/g, ' , ');
    }
    return cleaned_css;
  }

  getPathsFor(nodeset: HTMLElement[]): string[] {
    return nodeset.map(node => this.pathOf(node));
  }

  predictCss(selected: HTMLElement[], rejected: HTMLElement[]): string | null {
    if (selected.length === 0) return null;

    const selected_paths = this.getPathsFor(selected);
    const css = this.cssDiff(selected_paths);
    let simplest = this.simplifyCss(css, selected, rejected);

    if (simplest && simplest.length > 0) return simplest;

    let union = selected_paths.join(' , ');
    union = this.cleanCss(union);

    return this.simplifyCss(union, selected, rejected);
  }

  selectorGets(type: 'all' | 'none', list: HTMLElement[], selector: string): boolean {
    if (!selector || selector.trim() === '') {
        return type === 'none';
    }
    if (list.length === 0) {
        return type === 'none';
    }

    try {
        if (type === 'all') {
            // Every element in our list must match the selector.
            for (const el of list) {
                if (!el.matches(selector)) {
                    return false;
                }
            }
            return true;
        } else { // 'none'
            // No element in the list should match the selector.
            for (const el of list) {
                if (el.matches(selector)) {
                    return false;
                }
            }
            return true;
        }
    } catch (e) {
        return type === 'none';
    }
  }

  invertObject(obj: { [key: string]: string }): { [key: string]: string } {
    const new_obj: { [key: string]: string } = {};
    for (const prop in obj) {
      new_obj[obj[prop]] = prop;
    }
    return new_obj;
  }
}

// --- End of ported SelectorGadget core logic ---


// UI CREATION & EVENT LISTENERS

function createUI() {
  if (document.getElementById('selector-gadget-ui')) return;

  predictionHelper = new DomPredictionHelper();
  restrictedElements = Array.from(document.querySelectorAll('html, head, base, script, style'));

  ui = document.createElement('div');
  ui.id = 'selector-gadget-ui';
  ui.className = 'hidden';

  selectorInput = document.createElement('input');
  selectorInput.id = 'sg-selector-input';
  selectorInput.type = 'text';
  selectorInput.placeholder = 'Click an element to begin...';

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'sg-toggle-switch';
  toggleLabel.title = 'Toggle between CSS (off) and XPath (on)';
  modeToggle = document.createElement('input');
  modeToggle.type = 'checkbox';
  const slider = document.createElement('span');
  slider.className = 'sg-slider';
  toggleLabel.append(modeToggle, slider);

  const convertButton = document.createElement('button');
  convertButton.id = 'sg-convert-button';
  convertButton.title = 'Convert between CSS and XPath';
  convertButton.innerHTML = `<svg width="16" height="16" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>`;

  const clearButton = document.createElement('button');
  clearButton.id = 'sg-clear-button';
  clearButton.textContent = 'Clear';

  const copyButton = document.createElement('button');
  copyButton.id = 'sg-copy-button';
  copyButton.textContent = 'Copy';

  const closeButton = document.createElement('button');
  closeButton.id = 'sg-close-button';
  closeButton.title = 'Close Gadget';
  closeButton.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11 1L1 11M1 1L11 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  ui.append(selectorInput, toggleLabel, convertButton, clearButton, copyButton, closeButton);
  document.body.appendChild(ui);

  addEventListeners();
}

function addEventListeners() {
  selectorInput?.addEventListener('input', () => updateHighlightsFromInput());
  modeToggle?.addEventListener('change', () => {
    clearAllSelections();
    updatePrediction();
  });

  document.getElementById('sg-convert-button')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!selectorInput || !selectorInput.value || !modeToggle) return;

    if (modeToggle.checked) {
      if (lastCssSelector) {
        selectorInput.value = lastCssSelector;
        modeToggle.checked = false;
      }
    } else {
      const xpath = cssToXpath(selectorInput.value);
      selectorInput.value = xpath;
      modeToggle.checked = true;
    }
    updateHighlightsFromInput();
  });

  document.getElementById('sg-clear-button')?.addEventListener('click', clearAllSelections);

  document.getElementById('sg-copy-button')?.addEventListener('click', (e) => {
    if (selectorInput) {
      navigator.clipboard.writeText(selectorInput.value).then(() => {
        const button = e.currentTarget as HTMLButtonElement;
        const originalText = button.textContent;
        button.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        setTimeout(() => { button.textContent = originalText; }, 2000);
      }).catch(err => console.error('Failed to copy:', err));
    }
  });

  document.getElementById('sg-close-button')?.addEventListener('click', toggleGadget);

  document.addEventListener('mouseover', (e: MouseEvent) => {
    if (!isPicking || !e.target) return;
    lastHovered = e.target as HTMLElement;
    if (!ui?.contains(lastHovered)) {
      lastHovered.classList.add('sg-hover');
    }
  });

  document.addEventListener('mouseout', () => {
    lastHovered?.classList.remove('sg-hover');
  });

  document.addEventListener('click', handlePageClick, true);
}

function firstSelectedOrSuggestedParent(el: HTMLElement): HTMLElement | null {
    let current: HTMLElement | null = el;
    while (current) {
        if (restrictedElements.includes(current)) return null;
        if (current.classList.contains('sg-suggested') || current.classList.contains('sg-selected')) {
            return current;
        }
        if (current.parentElement === document.body || !current.parentElement) return null;
        current = current.parentElement;
    }
    return null;
}

function handlePageClick(event: MouseEvent) {
  if (!isPicking || ui?.contains(event.target as Node)) return;

  event.preventDefault();
  event.stopPropagation();

  let target = event.target as HTMLElement;
  const useXPath = modeToggle?.checked;

  if (useXPath) {
    // XPath mode keeps its simpler multi-select logic
    const index = selectedElements.indexOf(target);
    if (index > -1) {
      selectedElements.splice(index, 1);
    } else {
      selectedElements.push(target);
    }
    if (selectorInput) selectorInput.value = generateXPath(target);
    updateHighlightsForXpath();
  } else {
    // --- REFINED SELECTION LOGIC ---
    const parent = firstSelectedOrSuggestedParent(target);
    if (parent && parent !== target) {
        target = parent;
    }

    if (target.classList.contains('sg-selected')) {
      // It's green. Remove it from the positive list.
      selectedElements = selectedElements.filter(el => el !== target);
    } else if (target.classList.contains('sg-rejected')) {
      // It's red. Remove it from the negative list and add it to the positive list.
      rejectedElements = rejectedElements.filter(el => el !== target);
      selectedElements.push(target);
    } else if (target.classList.contains('sg-suggested')) {
      // It's yellow. Add it to the negative list to reject it.
      rejectedElements.push(target);
    } else {
      // It's neutral. Add it to the positive list.
      selectedElements.push(target);
    }

    updatePrediction();
  }
}

function toggleGadget() {
  if (!ui) createUI();
  isPicking = !isPicking;
  ui?.classList.toggle('hidden', !isPicking);
  if (!isPicking) clearAllSelections();
}

function clearAllSelections() {
  document.querySelectorAll('.sg-hover, .sg-suggested, .sg-selected, .sg-rejected').forEach(el => {
    el.classList.remove('sg-hover', 'sg-suggested', 'sg-selected', 'sg-rejected');
  });
  selectedElements = [];
  rejectedElements = [];
  lastCssSelector = null;
  if (selectorInput) {
    selectorInput.value = '';
    selectorInput.placeholder = 'Click an element to begin...';
  }
  const clearButton = document.getElementById('sg-clear-button');
  if (clearButton) {
    clearButton.textContent = 'Clear';
  }
}

function updateHighlightsFromInput() {
  document.querySelectorAll('.sg-suggested, .sg-selected, .sg-rejected').forEach(el => {
    el.classList.remove('sg-suggested', 'sg-selected', 'sg-rejected');
  });
  const selector = selectorInput?.value;
  if (!selector) return;

  if (!modeToggle?.checked) {
    lastCssSelector = selector;
  }

  try {
    const useXPath = modeToggle?.checked;
    let elements: Node[] = [];
    if (useXPath) {
      const result = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
      let node = result.iterateNext();
      while (node) { elements.push(node); node = result.iterateNext(); }
    } else {
      elements = Array.from(document.querySelectorAll(selector));
    }
    // Use sg-suggested for manual input highlighting
    elements.forEach(el => { if (el instanceof HTMLElement) el.classList.add('sg-suggested'); });
  } catch (error) { /* Invalid selector */ }
}

function updatePrediction() {
  // Clear all previous prediction-related classes
  document.querySelectorAll('.sg-suggested, .sg-selected, .sg-rejected').forEach(el => {
    el.classList.remove('sg-suggested', 'sg-selected', 'sg-rejected');
  });

  // Re-apply selections and rejections first, so we know what's explicitly chosen
  selectedElements.forEach(el => {
    el.classList.add('sg-selected');
  });

  rejectedElements.forEach(el => {
    el.classList.add('sg-rejected');
  });

  const prediction = predictionHelper.predictCss(selectedElements, rejectedElements.concat(restrictedElements));
  lastCssSelector = prediction;
  const clearButton = document.getElementById('sg-clear-button');

  if (selectorInput) {
    if (prediction) {
      selectorInput.value = prediction;
      selectorInput.placeholder = 'Refine selection or copy selector...';
    } else {
      // If no prediction, but we have state, show 'No valid path'. If no state, clear it.
      if (selectedElements.length > 0 || rejectedElements.length > 0) {
        selectorInput.value = 'No valid path found.';
      } else {
        selectorInput.value = '';
        selectorInput.placeholder = 'Click an element to begin...';
      }
    }
  }

  if (prediction) {
    try {
      const matched = document.querySelectorAll(prediction);
      if (clearButton) {
        // Update clear button with the count of matched elements.
        clearButton.textContent = `Clear (${matched.length})`;
      }
      matched.forEach(el => {
        if (el instanceof HTMLElement) {
          // Only add 'suggested' if it's not already selected or rejected by the user
          if (!el.classList.contains('sg-selected') && !el.classList.contains('sg-rejected')) {
            el.classList.add('sg-suggested');
          }
        }
      });
    } catch (e) { 
      if (clearButton) clearButton.textContent = 'Clear';
      console.error("Invalid selector generated:", prediction); 
    }
  } else {
    // If there's no prediction, reset the clear button text.
    if (clearButton) clearButton.textContent = 'Clear';
  }
}

function updateHighlightsForXpath() {
  // Clear all highlights first
  document.querySelectorAll('.sg-selected').forEach(el => el.classList.remove('sg-selected'));
  // Then re-apply to the current list
  selectedElements.forEach(el => el.classList.add('sg-selected'));
}

function cssToXpath(cssSelector: string): string {
  try {
    let xpath = '';
    const parts = cssSelector.split(/\s*>\s*/);
    
    parts.forEach((part) => {
      let tagName = part.match(/^[a-zA-Z0-9]*/)?.[0] || '*';
      const id = part.match(/#([\w-]+)/)?.[1];
      const classes = part.match(/\.[\w-]+/g)?.map(c => c.substring(1)) || [];

      if (id) {
        xpath += `/${tagName}[@id='${id}']`;
      } else {
        xpath += `/${tagName}`;
      }

      classes.forEach(cls => {
        xpath += `[contains(concat(' ', normalize-space(@class), ' '), ' ${cls} ')]`;
      });
    });
    return xpath.startsWith('/') ? `/${xpath}` : xpath;
  } catch (e) {
    return "Could not convert";
  }
}

function generateXPath(el: HTMLElement): string {
  if (el.id) return `//*[@id='${el.id}']`;
  const parts: string[] = [];
  while (el && el.nodeType === Node.ELEMENT_NODE) {
    let index = 1;
    let sibling = el.previousElementSibling;
    while (sibling) {
      if (sibling.nodeName === el.nodeName) index++;
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(`${el.nodeName.toLowerCase()}[${index}]`);
    el = el.parentNode as HTMLElement;
  }
  return parts.length ? '//' + parts.join('/') : '';
}

browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'TOGGLE_GADGET') {
    toggleGadget();
  }
});