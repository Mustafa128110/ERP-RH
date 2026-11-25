const glyphs: Record<string, string> = {"1/2":"½","1/3":"⅓","2/3":"⅔","1/4":"¼","3/4":"¾","1/5":"⅕","2/5":"⅖","3/5":"⅗","4/5":"⅘","1/6":"⅙","5/6":"⅚","1/7":"⅐","1/8":"⅛","3/8":"⅜","5/8":"⅝","7/8":"⅞","1/9":"⅑","1/10":"⅒"};
const fractionCharacters = Object.values(glyphs).join("");
const gcd = (a:number,b:number):number => b ? gcd(b,a%b) : a;
function fraction(n:string,d:string) {
  const numerator=Number(n),denominator=Number(d);
  if (!Number.isSafeInteger(numerator)||!Number.isSafeInteger(denominator)||denominator<=0) return `${n}/${d}`;
  const divisor=gcd(numerator,denominator);
  const key=`${numerator/divisor}/${denominator/divisor}`;
  return glyphs[key] ?? key.replace("/","⁄");
}
// Presentation only: product identity, stored names and invoice history stay intact.
export function productName(value:string):string {
  return value.replace(/(?<![\p{L}\p{N}])([0-9]+)[ -]+([0-9]+)\s*[\/⁄]\s*([0-9]+)(?![0-9])/gu, (original,whole,n,d) =>
    Number(n)<Number(d)&&Number(d)>0 ? `${whole}${fraction(n,d)}` : original)
    .replace(/([0-9]+)\s*[\/⁄]\s*([0-9]+)/g, (_original,n,d)=>fraction(n,d))
    .replace(new RegExp(`([0-9${fractionCharacters}])(["'′″]?)\\s*[xX]\\s*(?=[0-9${fractionCharacters}])`,"g"),"$1$2×");
}
export function productSearchText(value:string):string {
  return productName(value).normalize("NFKC").replaceAll("⁄","/").toLowerCase();
}
// A presentation-equivalent name must never select a different real product.
export function findProductName<T extends {name:string}>(options:T[],name:string):T|undefined{
 const exact=options.find(option=>option.name===name);if(exact)return exact;
 const matches=options.filter(option=>productSearchText(option.name)===productSearchText(name));
 return matches.length===1?matches[0]:undefined;
}
