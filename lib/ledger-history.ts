import type {HistoryRequest} from './history-window';
export type LedgerHistoryRequest=HistoryRequest & {from?:string;to?:string;showCancelled?:boolean};
export type LedgerHistorySummary={opening:number;totalDebit:number;totalCredit:number;closing:number};
