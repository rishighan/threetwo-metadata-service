"use strict";

import axios from "axios";
import { Context, Service, ServiceBroker } from "moleculer";

const METRON_BASE_URL = "https://metron.cloud/api/";

export default class MetronService extends Service {
	public constructor(public broker: ServiceBroker) {
		super(broker);
		this.parseServiceSchema({
			name: "metron",
			actions: {
				fetchResource: {
					rest: "POST /fetchResource",
					params: {},
					handler: async (
						ctx: Context<{
							resource: string;
							method: string;
							query: {
								name: string;
								page: number;
							};
						}>
					) => {
						console.log(ctx.params);
						const results = await axios({
							method: "GET",
							url: `https://metron.cloud/api/${ctx.params.resource}`,
							params: {
								name: ctx.params.query.name,
								page: ctx.params.query.page,
							},
							headers: {
								"Authorization": "Basic ZnJpc2hpOlRpdHVAMTU4OA=="
							},
							auth: {
								"username": "frishi",
								"password": "Titu@1588"
							}

						});
						return results.data;
					},
				},
			},
			methods: {},
		});
	}
}
