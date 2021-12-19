"use strict";

import { Service, ServiceBroker, Context } from "moleculer";
import axios, { AxiosResponse } from "axios";
import { matchScorer } from "../utils/searchmatchscorer.utils";
const CV_BASE_URL = "https://comicvine.gamespot.com/api/";
console.log("KEYYYYYYYY", process.env.COMICVINE_API_KEY);
export default class ComicVineService extends Service {
	public constructor(public broker: ServiceBroker) {
		super(broker);
		this.parseServiceSchema({
			name: "comicvine",
			requestTimeout: 90000,
			actions: {
				fetchResource: {
					rest: "/fetchresource",
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
						const {
							format,
							sort,
							query,
							fieldList,
							limit,
							offset,
							resources,
						} = ctx.params;
						const response = await axios.request({
							url:
								CV_BASE_URL +
								"search" +
								"?api_key=" +
								process.env.COMICVINE_API_KEY,
							params: {
								format,
								sort,
								query,
								fieldList,
								limit,
								offset,
								resources,
							},
							transformResponse: (r) => {
								const matches = JSON.parse(r);
								return matchScorer(
									matches.results,
									ctx.params.scorerConfiguration.searchQuery,
									ctx.params.scorerConfiguration
										.rawFileDetails
								);
							},
							headers: { Accept: "application/json" },
						});
						const { data } = response;
						return data;
					},
				},
				search: {
					rest: "/search",
					params: {},
					handler: async (
						ctx: Context<{
							format: string;
							sort: string;
							query: string;
							fieldList: string;
							limit: string;
							offset: string;
							resources: string;
						}>
					) => {
						const response = await axios.request({
							url:
								CV_BASE_URL +
								"search" +
								"?api_key=" +
								process.env.COMICVINE_API_KEY,
							params: ctx.params,
							headers: { Accept: "application/json" },
						});
						const { data } = response;
						return data;
					},
				},
				getVolumes: {
					rest: "POST /getVolumes",
					params: {},
					handler: async (
						ctx: Context<{
							volumeURI: string;
							data: {};
						}>
					) => {
						const response = await axios.request({
							url:
								ctx.params.volumeURI +
								"?api_key=" +
								process.env.COMICVINE_API_KEY,
							params: ctx.params.data,
							headers: { Accept: "application/json" },
						});
						const { data } = response;
						return data;
					},
				},
				volumeBasedSearch: {
					rest: "POST /volumeBasedSearch",
					params: {},
					headers: { Accept: "application/json" },
					bulkhead: {
						enabled: true,
						concurrency: 10,
						maxQueueSize: 10,
					},
					handler: async (
						ctx: Context<{
							format: string;
							sort: string;
							query: string;
							fieldList: string;
							limit: number;
							offset: number;
							resources: string;
							scorerConfiguration?: {
								searchQuery: {
									issue: object;
									series: object;
								};
								rawFileDetails: object;
							};
						}>
					) => {
						const fo: any = [];
						const foo = await this.fetchVolumesFromCV(
							ctx.params,
							fo
						);
						return foo;
					},
				},
			},
			methods: {
				fetchVolumesFromCV: async (params, output: any[] = []) => {
					let currentPage = parseInt(params.page, 10);
					const response = await axios.request({
						url:
							CV_BASE_URL +
							"search" +
							"?api_key=" +
							process.env.COMICVINE_API_KEY,
						params,
						headers: { Accept: "application/json" },
					});

					const { data } = response;
					// 1. calculate total pages
					const totalPages = Math.floor(
						parseInt(data.number_of_total_results, 10) /
							parseInt(params.limit, 10)
					);
					if (currentPage < totalPages) {
						output.push(data.results);
						currentPage += 1;
						params.page = currentPage;
						console.log(currentPage);
						return await this.fetchVolumesFromCV(params, output);
					} else {
						return output;
					}
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
