"use strict";

import { createWriteStream } from "fs";
import path from "path";
import https from "https";
import { Service, ServiceBroker, Context } from "moleculer";
import axios from "axios";
import leven from "leven";
import { matchScorer } from "../utils/searchmatchscorer.utils";
const CV_BASE_URL = "https://comicvine.gamespot.com/api/";
const CV_API_KEY = "a5fa0663683df8145a85d694b5da4b87e1c92c69";

export default class GreeterService extends Service {
	public constructor(public broker: ServiceBroker) {
		super(broker);
		this.parseServiceSchema({
			name: "comicvine",
			actions: {
				fetchSeries: {
					rest: "/fetchseries",
					params: {
						format: { type: "string", optional: false },
						sort: { type: "string", optional: true },
						query: { type: "string", optional: false },
						fieldList: { type: "string", optional: true },
						limit: { type: "string", optional: false },
						offset: { type: "string", optional: false },
						resources: { type: "string", optional: false },
					},
					handler: async (
						ctx: Context<{
							format: string;
							sort: string;
							query: string;
							fieldList: string;
							limit: string;
							offset: string;
							resources: string;
							scorerConfiguration: {
								searchQuery: {
									issue: object;
									series: object;
								};
								rawFileDetails: object;
							};
						}>
					): Promise<any> => {
						const response = await axios.request({
							url:
								CV_BASE_URL +
								"search" +
								"?api_key=" +
								CV_API_KEY,
							params: ctx.params,
							transformResponse: r => {
								const matches = JSON.parse(r);
								return matchScorer(
									matches.results,
									ctx.params.scorerConfiguration.searchQuery,
									ctx.params.scorerConfiguration.rawFileDetails
								);
							},
							headers: { Accept: "application/json" },
						});
						const { data } = response;
						return data;
					},
				},
			},
		});
	}

	// Action
	public ActionHello(): string {
		return "Hello Moleculer";
	}

	public ActionWelcome(name: string): string {
		return `Welcome, ${name}`;
	}
}
