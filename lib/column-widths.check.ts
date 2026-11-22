import assert from "node:assert/strict";
import { columnWidthKey, fittedColumnWidth, createColumnLayout, minimumColumnWidth, TABLE_COLUMN_GUTTER } from "./column-widths";

assert.equal(columnWidthKey("__sno"), columnWidthKey("rowNumber"));
assert.equal(columnWidthKey("unitPrice"), columnWidthKey("salesRate"));
assert.equal(columnWidthKey("item_name"), columnWidthKey("productName"));
assert.equal(columnWidthKey("saleType"), columnWidthKey("channel"));
assert.equal(fittedColumnWidth(50, [100, 720], 100), 752, "longest content plus fixed column gutters must fit without cropping");
assert.equal(fittedColumnWidth(0, [], 100), 100);
assert.equal(TABLE_COLUMN_GUTTER,12);
const columns=[{key:"__sno",minimum:minimumColumnWidth("__sno")},{key:"name",minimum:180},{key:"total",minimum:120},{key:"actions",minimum:80}];
const layout=createColumnLayout(columns);
assert.equal(layout.minimumWidth,444);
assert.equal(layout.shares[0],0,"row numbers never absorb spare screen width");
assert.equal(layout.shares[3],0,"action controls remain compact");
assert.ok(Math.abs(layout.shares[1]-5*layout.shares[2])<1e-12,"names receive more spare width than numeric facts");
for(const available of [320,444,1280,2560]){
 const resized=createColumnLayout(columns,available);
 const extra=Math.max(0,available-layout.minimumWidth);
 const widths=columns.map((column,index)=>column.minimum+extra*layout.shares[index]);
 assert.ok(widths.every((width,index)=>width>=columns[index].minimum),"narrow screens preserve every content minimum");
 assert.ok(Math.abs(widths.reduce((sum,width)=>sum+width,0)-Math.max(available,layout.minimumWidth))<1e-8,"wide tables fill the available space exactly");
 assert.equal(widths[0],64,"serial stays compact on every screen size");
 assert.equal(resized.tableWidth,Math.max(available,layout.minimumWidth));
 assert.ok(Math.abs(resized.widths.reduce((sum,width)=>sum+parseFloat(width),0)-resized.tableWidth)<1e-8,"allocated pixel widths fill the table exactly");
}
assert.equal(createColumnLayout([]).minimumWidth,0);
assert.deepEqual(createColumnLayout([{key:"__sno",minimum:64}]).widths,["64px"]);
assert.deepEqual(createColumnLayout([{key:"module",minimum:160},{key:"view",minimum:90,grow:0},{key:"edit",minimum:90,grow:0}],1600).widths,["1420px","90px","90px"],"checkbox-only columns do not absorb spare space");
console.log("global column sizing checks passed");
