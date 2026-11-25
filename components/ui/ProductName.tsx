import {productName} from "@/lib/product-name";

export function ProductName({name}:{name:string}) {
  return <span className="product-name">{productName(name).split(/([¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/).map((part,index)=>
    /[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/.test(part)?<span key={index} className="product-fraction">{part}</span>:part)}</span>;
}
