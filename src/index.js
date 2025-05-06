/**
 * This worker will update a zero trust list with high risk users from User risk scores
 * 
 * The worker can be triggered on demand when querying the worker hostname AND according to a cron schedule
 * 
 * The ZT list that is updated should be set in wrangler.jsonc (env.LIST_ID)
 * Account ID and API keys should be defined as wrangler secrets
 * 
 */

export default {
	// This function runs when we query the worker hostname
	async fetch(request, env, ctx) {
		return await handleRequest(request, env);
	},

    // This function runs according to the cron schedule
    async scheduled(event, env, ctx) {
      await handleRequest('notfetch',env);
    }
};

async function handleRequest(request, env) {

	// Inputs for Cloudflare API calls. Stored locally in .dev.var and in the edge in Workers secrets
	const accountId = env.ACCOUNT_ID;
	const userEmail = env.USER_EMAIL;
	const apiKey = env.API_KEY;
	const listId = env.LIST_ID;
  
	// Optimization - if fetch, stop the worker if browser is requesting favicon.ico
	if (request != 'notfetch') {
	  const urlRequest = new URL(request.url);
	  const checkFavicon = urlRequest.pathname.slice(1);
	  if(checkFavicon == "favicon.ico"){
		  return new Response(null, { status: 204 });
	  }
	}
    
	// STEP 01 - get the list of users and their risk scores
	const userRiskScores = `https://api.cloudflare.com/client/v4/accounts/${accountId}/zt_risk_scoring/summary`;
	let userRiskScoresResponse = await fetch(userRiskScores, {
		  method: 'GET',
		  headers: {
			  'X-Auth-Email': userEmail,
			  'X-Auth-Key': apiKey,
			  'Content-Type': 'application/json'
		  }
	  });
	let userRiskScoresData = await userRiskScoresResponse.json();
	//console.log("The user risk score data I got from the API: "+userRiskScoresData.result)

	// STEP 02 - create the JSON file to update the user-risk-scores list
	const ztListResult = {"remove": [], "append": []}

	// STEP 02a - gather high risk users that should belong on the ZT list
	for (let user of userRiskScoresData.result.users) {
		if (user.max_risk_level == 'high'){
			ztListResult.append.push({ "value": user.email, "description": "high risk"})
		}
	}

	// STEP 02b - clean the existing user list from the ZT list	
	const gwListUpdate = `https://api.cloudflare.com/client/v4/accounts/${accountId}/gateway/lists/${listId}`

	let gwCleanResponse = await fetch(gwListUpdate+"/items", {
		method: 'GET',
		headers: {
		  'X-Auth-Email': userEmail,
		  'X-Auth-Key': apiKey,
		  'Content-Type': 'application/json'
		}
	});
	let gwCleanData = await gwCleanResponse.json();
	  
	//console.log("The data I need to clean from the list: "+gwCleanData.result)
	if (gwCleanData.result != null){
		for (let entry of gwCleanData.result) {
		  ztListResult.remove.push(entry.value)
		}
	}

	// This is the body of the payload that will update the list
	const jsonOutput = JSON.stringify(ztListResult);

	// STEP 03 - Update the ZT lists
	const response = await fetch(gwListUpdate, {
		method: 'PATCH',
		headers: {
		  'X-Auth-Email': userEmail,
		  'X-Auth-Key': apiKey,
		  'Content-Type': 'application/json'
		},
		body: jsonOutput,
	  });
  
	// Fetch - Provide response
	if (request != 'notfetch') {
	  return new Response(JSON.stringify("Gateway lists updated!"), {
		headers: {
		  'Content-Type': 'application/json',
		},
	  });
	}
}