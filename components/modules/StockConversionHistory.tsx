import {listStockConversions,getConversionOptions} from "@/lib/actions/stock-conversions";
import {StockConversionManager} from "@/components/modules/StockConversionManager";
export async function StockConversionHistory(){const [rows,options]=await Promise.all([listStockConversions(),getConversionOptions()]);return <StockConversionManager rows={rows} options={options}/>;}
