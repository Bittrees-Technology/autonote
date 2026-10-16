import {currentUser,checkOrigin,rateLimit} from '@/lib/auth';
import {userCalendarContext} from '@/lib/calendar';
import {z} from 'zod';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
export async function GET(req:Request){try{const user=await currentUser(req);await rateLimit('calendar-context:'+user!.id,100);const item=z.uuid().parse(new URL(req.url).searchParams.get('item'));return Response.json(await userCalendarContext(user!.id,item),{headers});}catch(e:any){return Response.json({error:e.status?e.message:'Calendar meeting is unavailable.'},{status:e.status||400,headers});}}
export async function POST(req:Request){try{checkOrigin(req);const user=await currentUser(req);await rateLimit('calendar-link:'+user!.id,100);if(Number(req.headers.get('content-length')||0)>2048)return Response.json({error:'Request too large.'},{status:413,headers});const d=z.strictObject({itemId:z.uuid(),meetingId:z.uuid(),revision:z.int().positive()}).parse(await req.json());return Response.json(await userCalendarContext(user!.id,d.itemId,d.meetingId,d.revision),{headers});}catch(e:any){return Response.json({error:e.status?e.message:'Could not link this Calendar meeting.'},{status:e.status||400,headers});}}
