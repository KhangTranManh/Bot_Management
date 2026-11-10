The container for every block in the rail: a notched panel with magenta corner brackets and a `//` heading.

- Markup: `<section class="no-panel no-notch">` then `<h2 class="no-panel__head"><span>Title</span><span class="no-panel__count">N</span></h2>`.
- Surface `panel`, border `line`, shadow `panel-depth`, padding `space-3.5`, gap `space-2.5`. Corners: `notch-md` cut top-right and bottom-left, 14px brackets in `magenta` on the other two.
- Headings are a noun phrase in Vietnamese, set uppercase by the class (`label` style). The count is the number of rows, in `fg`.
- Panels stack in one column 340px wide with `space-3.5` between them. Do not nest panels.
