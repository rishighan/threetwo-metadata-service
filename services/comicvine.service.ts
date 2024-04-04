"use strict";

import { Service, ServiceBroker, Context } from "moleculer";
import axios from "axios";
import delay from "delay";
import { isNil } from "lodash";
import { fetchReleases, FilterTypes, SortTypes } from "comicgeeks";
import { matchScorer, rankVolumes } from "../utils/searchmatchscorer.utils";
import {
	scrapeIssuesFromSeriesPage,
	scrapeIssuePage,
} from "../utils/scraping.utils";
const { calculateLimitAndOffset, paginate } = require("paginate-info");

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
				getIssuesForSeries: {
					rest: "POST /getIssuesForSeries",
					handler: async (
						ctx: Context<{ comicObjectId: string }>
					) => {
						const { comicObjectId } = ctx.params;
						// 1. Query mongo to get the comic document by its _id
						const comicBookDetails: any = await this.broker.call(
							"library.getComicBookById",
							{ id: comicObjectId }
						);
						// 2. Query CV and get metadata for them
						const issues = await axios({
							url:
								CV_BASE_URL +
								"issues" +
								"?api_key=" +
								process.env.COMICVINE_API_KEY,
							params: {
								resources: "issues",
								limit: "100",
								format: "json",
								filter: `volume:${comicBookDetails.sourcedMetadata.comicvine.volumeInformation.id}`,
							},
							headers: {
								Accept: "application/json",
								"User-Agent": "ThreeTwo",
							},
						});
						return issues.data;
					},
				},
				scrapeLOCGForSeries: {
					rest: "POST /scrapeLOCGForSeries",
					params: {},
					handler: async (ctx: Context<{}>) => {
						const seriesURIFragment = await scrapeIssuePage(
							"https://leagueofcomicgeeks.com/comic/5878833/hulk-4"
						);
						return await scrapeIssuesFromSeriesPage(
							`https://leagueofcomicgeeks.com/${seriesURIFragment}`
						);
					},
				},
				getWeeklyPullList: {
					rest: "GET /getWeeklyPullList",
					params: {},
					timeout: 10000000,
					handler: async (
						ctx: Context<{
							startDate: string;
							currentPage: string;
							pageSize: string;
						}>
					) => {
						const { currentPage, pageSize } = ctx.params;
						const { limit, offset } = calculateLimitAndOffset(
							currentPage,
							pageSize
						);

						const response = await fetchReleases(
							new Date(ctx.params.startDate),
							{
								publishers: [
									"DC Comics",
									"Marvel Comics",
									"Image Comics",
								],
								filter: [
									FilterTypes.Regular,
									FilterTypes.Digital,
									FilterTypes.Annual,
								],
								sort: SortTypes.AlphaAsc,
							}
						);

						const count = response.length;
						const paginatedData = response.slice(
							offset,
							offset + limit
						);
						const paginationInfo = paginate(
							currentPage,
							count,
							paginatedData
						);
						return { result: paginatedData, meta: paginationInfo };
					},
				},
				getStoryArcs: {
					rest: "POST /getStoryArcs",
					handler: async (ctx: Context<{ comicObject: any }>) => {
						const { comicObject } = ctx.params;
						console.log(JSON.stringify(comicObject, null, 2));
						// 2. Query CV and get metadata for them
						const storyArcs = await axios({
							url:
								CV_BASE_URL +
								"story_arcs" +
								"?api_key=" +
								process.env.COMICVINE_API_KEY,
							params: {
								resources: "story_arcs",
								limit: "100",
								format: "json",
								filter: `volume:${comicObject.sourcedMetadata.comicvine.volumeInformation.id}`,
							},
							headers: {
								Accept: "application/json",
								"User-Agent": "ThreeTwo",
							},
						});
						return storyArcs.data;
					},
				},
				volumeBasedSearch: {
					rest: "POST /volumeBasedSearch",
					params: {},
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
									name: string;
									subtitle?: string;
									number: string;
									year: string;
								};
							};
							rawFileDetails: object;
						}>
					) => {
						try {
							console.log(
								"Searching against: ",
								ctx.params.scorerConfiguration.searchParams
							);
							const { rawFileDetails, scorerConfiguration } =
								ctx.params;
							const results: any = [];
							console.log(
								"passed to fetchVolumesFromCV",
								ctx.params
							);
							const volumes = await this.fetchVolumesFromCV(
								ctx.params,
								results
							);
							// 1. Run the current batch of volumes through the matcher
							const potentialVolumeMatches = rankVolumes(
								volumes,
								ctx.params.scorerConfiguration
							);

							// 2. Construct the filter string
							// 2a. volume: 1111|2222|3333
							let volumeIdString = "volume:";
							potentialVolumeMatches.map(
								(volumeId: string, idx: number) => {
									if (
										idx >=
										potentialVolumeMatches.length - 1
									) {
										volumeIdString += `${volumeId}`;
										return volumeIdString;
									}
									volumeIdString += `${volumeId}|`;
								}
							);

							// 2b. E.g.: cover_date:2014-01-01|2016-12-31 for the issue year 2015
							let coverDateFilter = "";
							if (
								!isNil(
									ctx.params.scorerConfiguration.searchParams
										.year
								)
							) {
								const issueYear = parseInt(
									ctx.params.scorerConfiguration.searchParams
										.year,
									10
								);
								coverDateFilter = `cover_date:${
									issueYear - 1
								}-01-01|${issueYear + 1}-12-31`;
							}
							const filterString = `issue_number:${ctx.params.scorerConfiguration.searchParams.number},${volumeIdString},${coverDateFilter}`;
							console.log(filterString);

							const issueMatches = await axios({
								url:
									CV_BASE_URL +
									"issues" +
									"?api_key=" +
									process.env.COMICVINE_API_KEY,
								params: {
									resources: "issues",
									limit: "100",
									format: "json",
									filter: filterString,
								},
								headers: {
									Accept: "application/json",
									"User-Agent": "ThreeTwo",
								},
							});
							console.log(
								`Total issues matching the criteria: ${issueMatches.data.results.length}`
							);
							// 3. get volume information for the issue matches
							if (issueMatches.data.results.length === 1) {
								const volumeInformation =
									await this.broker.call(
										"comicvine.getVolumes",
										{
											volumeURI:
												issueMatches.data.results[0]
													.volume.api_detail_url,
										}
									);
								issueMatches.data.results[0].volumeInformation =
									volumeInformation;
								return issueMatches.data;
							}
							const finalMatches = issueMatches.data.results.map(
								async (issue: any) => {
									const volumeDetails =
										await this.broker.call(
											"comicvine.getVolumes",
											{
												volumeURI:
													issue.volume.api_detail_url,
											}
										);
									issue.volumeInformation = volumeDetails;
									return issue;
								}
							);

							// Score the final matches
							const foo = await this.broker.call(
								"comicvine.getComicVineMatchScores",
								{
									finalMatches,
									rawFileDetails,
									scorerConfiguration,
								}
							);
							return Promise.all(finalMatches);
						} catch (error) {
							console.log(error);
						}
					},
				},
				getComicVineMatchScores: {
					rest: "POST /getComicVineMatchScores",
					handler: async (
						ctx: Context<{
							finalMatches: Array<any>;
							rawFileDetails: any;
							scorerConfiguration: any;
						}>
					) => {
						const {
							finalMatches,
							rawFileDetails,
							scorerConfiguration,
						} = ctx.params;
						console.log(ctx.params);
						return await matchScorer(
							finalMatches,
							scorerConfiguration.searchParams,
							rawFileDetails
						);
					},
				},
			},
			methods: {
				fetchVolumesFromCV: async (payload, output: any[] = []) => {
					const { format, query, limit, page, resources } = payload;
					let currentPage = parseInt(page, 10);
					const response = await axios.request({
						url:
							CV_BASE_URL +
							"search" +
							"?api_key=" +
							process.env.COMICVINE_API_KEY,
						params: {
							format,
							query,
							limit,
							page,
							resources,
						},
						headers: {
							Accept: "application/json",
							"User-Agent": "ThreeTwo",
						},
					});

					const { data } = response;
					// 1. Calculate total pages
					const totalPages = Math.floor(
						parseInt(data.number_of_total_results, 10) /
							parseInt(limit, 10)
					);
					// 1a. If total results are <= 100, just return the results
					if (parseInt(data.number_of_total_results, 10) <= 100) {
						return [...data.results];
					}
					// 1b. If not, recursively call fetchVolumesFromCV till we have fetched all pages
					if (currentPage <= totalPages) {
						output.push(...data.results);
						currentPage += 1;
						// Params.page = currentPage;

						console.log(
							`Fetching results for page ${currentPage} (of ${
								totalPages + 1
							})...`
						);

						await this.broker.call("socket.broadcast", {
							namespace: "/",
							event: "CV_SCRAPING_STATUS",
							args: [
								{
									message: `Fetching results for page ${currentPage} (of ${
										totalPages + 1
									})...`,
								},
							],
						});
						return await this.fetchVolumesFromCV(
							{
								format,
								query,
								limit,
								page: currentPage,
								resources,
							},
							output
						);
					} else {
						return [...output];
					}
				},
			},
		});
	}
}
