export const HISTORY_PAGE_SIZE = 100;
export type HistoryRequest = { page?: number; query?: string; sort?: string; direction?: string; all?: boolean };
export type HistoryInfo = { page: number; pageSize: number; total: number; recordTotal?: number; query: string; sort: string; direction: "asc" | "desc"; all: boolean };
export function historyRequest(params: Record<string, string | string[] | undefined>): HistoryRequest {
  const value=(key:string)=>typeof params[key]==="string"?params[key] as string:undefined;
  return {page:Math.max(1,Math.floor(Number(value("page"))||1)),query:value("q")?.slice(0,300),sort:value("sort"),direction:value("order")??(['asc','desc'].includes(value('direction')??'')?value('direction'):undefined),all:value("all")==="1"};
}
