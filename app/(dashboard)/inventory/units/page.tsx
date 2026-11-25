import Link from "next/link";
import {requireSession} from "@/lib/auth/session";
import {redirect} from "next/navigation";
import {listUnits} from "@/lib/actions/units";
import {listUnitConversions,getUnitConversion} from "@/lib/actions/unit-conversions";
import {getItemOptions,getUnits} from "@/lib/queries/lookups";
import {UnitManager} from "@/components/modules/UnitManager";
import {UnitConversionManager} from "@/components/modules/UnitConversionManager";
import {WorkspaceControls} from "@/components/layout/TableWorkspace";
export const dynamic="force-dynamic";
export default async function UnitsPage({searchParams}:{searchParams:Promise<{view?:string}>}) {
 const [session,params]=await Promise.all([requireSession(),searchParams]);
 const allowed=new Set([...session.globalPermissions,...[...session.permissionsByCompany.values()].flatMap(set=>[...set])]);
 const tabs=[{id:"units",name:"Units",permission:"units.view"},{id:"rules",name:"Conversion rules",permission:"unit_conversions.view"}].filter(tab=>allowed.has(tab.permission));
 if(!tabs.length)redirect("/settings");
 const view=tabs.some(tab=>tab.id===params.view)?params.view:tabs[0].id;
 let content;
 if(view==="rules") {const [conversions,itemOptions,unitOptions]=await Promise.all([listUnitConversions(),getItemOptions(),getUnits()]);content=<UnitConversionManager conversions={conversions} getDetail={getUnitConversion} itemOptions={itemOptions} unitOptions={unitOptions}/>;}
 else content=<UnitManager units={await listUnits()}/>;
 return <div className="flex h-full min-h-0 flex-col gap-3"><WorkspaceControls label="Unit sections" mobileRail className="flex flex-wrap gap-2"><Link href="/settings" className="rounded border border-sand px-3 py-2 text-sm">Settings</Link>{tabs.map(tab=><Link key={tab.id} href={`/inventory/units?view=${tab.id}`} aria-current={view===tab.id?"page":undefined} className={`rounded border border-sand px-3 py-2 text-sm ${view===tab.id?"bg-navy-800 text-white":"text-steel"}`}>{tab.name}</Link>)}</WorkspaceControls><div className="min-h-0 flex-1">{content}</div></div>;
}
