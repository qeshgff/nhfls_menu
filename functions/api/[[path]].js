import { handleRequest } from '../../server/reviews.mjs';
export const onRequest = ({ request, env }) => handleRequest(request,env);
