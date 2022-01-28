"use strict";

import { Service, ServiceBroker, Context } from "moleculer";
import axios from "axios";
import { matchScorer, rankVolumes } from "../utils/searchmatchscorer.utils";
import { isNil } from "lodash";

const CV_BASE_URL = "https://comicvine.gamespot.com/api/";
console.log("ComicVine API Key: ", process.env.COMICVINE_API_KEY);
export default class ComicVineService extends Service {
	public constructor(public broker: ServiceBroker) {
		super(broker);
		this.parseServiceSchema({
			name: "comicvine",
			actions: {
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
							params: {
								format: "json",
							},
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
					timeout: 10000000,
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
								searchParams: {
									searchTerms: {
										name: string;
										subtitle?: string;
										number: string;
										year: string;
									};
								};
							};
							rawFileDetails: object;
						}>
					) => {
						console.log("Searching against: ", ctx.params.scorerConfiguration.searchParams.searchTerms);
						const results: any = [];
						const volumes = await this.fetchVolumesFromCV(
							ctx.params,
							results,
						);
						// 1. Run the current batch of volumes through the matcher
						const potentialVolumeMatches = rankVolumes(volumes, ctx.params.scorerConfiguration);

						// 2. Construct the filter string
						// 2a. volume: 1111|2222|3333
						let volumeIdString = "volume:";
						potentialVolumeMatches.map((volumeId: string, idx: number) => {
							if(idx >= potentialVolumeMatches.length - 1) {
								volumeIdString += `${volumeId}`;
								return volumeIdString;
							}
							volumeIdString += `${volumeId}|`;
						});

						// 2b. cover_date:2014-01-01|2016-12-31 for the issue year 2015
						let coverDateFilter = "";
						if(!isNil(ctx.params.scorerConfiguration.searchParams.searchTerms.year)) {
							const issueYear = parseInt(ctx.params.scorerConfiguration.searchParams.searchTerms.year, 10);
							coverDateFilter = `cover_date:${issueYear - 1}-01-01|${issueYear + 1}-12-31`;
						}
						const filterString = `issue_number:${ctx.params.scorerConfiguration.searchParams.searchTerms.number},${volumeIdString},${coverDateFilter}`;
						console.log(filterString);

						const issueMatches = await axios({
							url: `https://comicvine.gamespot.com/api/issues?api_key=${process.env.COMICVINE_API_KEY}`,
							params: {
								resources: "issues",
								limit: "100",
								format: "json",
								filter: filterString,
							},
							headers: {"User-Agent": "ThreeTwo"},
						});
						console.log(`Total issues matching the criteria: ${issueMatches.data.results.length}`);
						// 3. get volume information for the issue matches
						if(issueMatches.data.results.length === 1) {
							const volumeInformation = await this.broker.call("comicvine.getVolumes", { volumeURI: issueMatches.data.results[0].volume.api_detail_url });
							issueMatches.data.results[0].volumeInformation = volumeInformation;
							return issueMatches.data;
						}
						const finalMatches = issueMatches.data.results.map(async (issue: any) => {
							const volumeDetails = await this.broker.call("comicvine.getVolumes", { volumeURI: issue.volume.api_detail_url });
							issue.volumeInformation = volumeDetails;
							return issue;
						});
						return Promise.all(finalMatches);


					},
				},
			},
			methods: {
				fetchVolumesFromCV: async (params, output: any[] = []) => {
					let currentPage = parseInt(params.page, 10);
					const response = await axios.request({
						url: `https://comicvine.gamespot.com/api/search?api_key=${process.env.COMICVINE_API_KEY}`,
						params,
						headers: {"User-Agent": "ThreeTwo"},

					});

					const { data } = response;
					// 1. Calculate total pages
					const totalPages = Math.floor(
						parseInt(data.number_of_total_results, 10) /
							parseInt(params.limit, 10)
					);
					// 1a. If total results are <= 100, just return the results
					if(parseInt(data.number_of_total_results, 10) <= 100 ) {
						return [...data.results];
					}
					// 1b. If not, recursively call fetchVolumesFromCV till we have fetched all pages
					if (currentPage <= totalPages) {
						output.push(...data.results);
						currentPage += 1;
						params.page = currentPage;
						console.log(`Fetching results for page ${currentPage} (of ${totalPages + 1})...`);
						return await this.fetchVolumesFromCV(params, output);
					} else {
						return [...output];
					}
				},
			},
		});
	}
}
