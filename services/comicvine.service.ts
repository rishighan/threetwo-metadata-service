"use strict";

import { Service, ServiceBroker, Context } from "moleculer";
import axios from "axios";
import { isNil, isUndefined } from "lodash";
import { fetchReleases, FilterTypes, SortTypes } from "comicgeeks";
import { matchScorer, rankVolumes } from "../utils/searchmatchscorer.utils";
import {
	scrapeIssuesFromSeriesPage,
	scrapeIssuePage,
} from "../utils/scraping.utils";
const { calculateLimitAndOffset, paginate } = require("paginate-info");
const { MoleculerError } = require("moleculer").Errors;

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
							field_list: string;
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
							fieldList: string;
						}>
					) => {
						const { volumeURI, fieldList } = ctx.params;
						const response = await axios.request({
							url:
								volumeURI +
								"?api_key=" +
								process.env.COMICVINE_API_KEY,
							params: {
								format: "json",
								field_list: fieldList,
							},
							headers: {
								Accept: "application/json",
								"User-Agent": "ThreeTwo",
							},
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
				getResource: {
					rest: "POST /getResource",
					handler: async (
						ctx: Context<{
							resources: string;
							filter: string;
							fieldList: string;
						}>
					) => {
						const { resources, filter, fieldList } = ctx.params;
						console.log(JSON.stringify(ctx.params, null, 2));
						console.log(
							CV_BASE_URL +
								`${resources}` +
								"?api_key=" +
								process.env.COMICVINE_API_KEY
						);
						// 2. Query CV and get metadata for them
						const response = await axios({
							method: "GET",
							url:
								CV_BASE_URL +
								`${resources}` +
								"?api_key=" +
								process.env.COMICVINE_API_KEY,
							params: {
								resources: `${resources}`,
								limit: "100",
								format: "json",
								filter: `${filter}`,
								field_list: `${fieldList}`,
							},
							headers: {
								Accept: "application/json",
								"User-Agent": "ThreeTwo",
							},
						});
						console.log(response.data);
						return response.data;
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
				getStoryArcs: {
					rest: "POST /getStoryArcs",
					handler: async (
						ctx: Context<{ volumeUrl: string; volumeId: number }>
					) => {
						const { volumeUrl, volumeId } = ctx.params;
						try {
							const volumeResponse = await axios({
								url:
									volumeUrl +
									"?api_key=" +
									process.env.COMICVINE_API_KEY,
								method: "GET",
								params: {
									limit: "100",
									format: "json",
									resources: "volumes",
								},
								headers: {
									Accept: "application/json",
									"User-Agent": "ThreeTwo",
								},
							});
							const volumeData = volumeResponse.data;

							if (volumeData.results.issues.length > 0) {
								const issuePromises =
									volumeData.results.issues.map(
										async (issue: any) => {
											const issueUrl = `${CV_BASE_URL}issue/4000-${issue.id}/?api_key=${process.env.COMICVINE_API_KEY}&format=json&field_list=story_arc_credits,description,image`;
											try {
												const issueResponse =
													await axios.get(issueUrl, {
														params: {
															limit: "100",
															format: "json",
														},
														headers: {
															Accept: "application/json",
															"User-Agent":
																"ThreeTwo",
														},
													});
												const issueData =
													issueResponse.data.results;

												// Transform each story arc to include issue's description and image
												return (
													issueData.story_arc_credits?.map(
														(arc: any) => ({
															...arc,
															issueDescription:
																issueData.description,
															issueImage:
																issueData.image,
														})
													) || []
												);
											} catch (error) {
												console.error(
													"An error occurred while fetching issue data:",
													error.message
												);
												return []; // Return an empty array on error
											}
										}
									);

								try {
									const storyArcsResults: any =
										await Promise.all(issuePromises);
									// Flatten the array of arrays
									const flattenedStoryArcs =
										storyArcsResults.flat();

									// Deduplicate based on arc ID, while preserving the last seen issueDescription and issueImage
									const uniqueStoryArcs = Array.from(
										new Map(
											flattenedStoryArcs.map(
												(arc: any) => [arc.id, arc]
											)
										).values()
									);

									console.log(
										`Found ${uniqueStoryArcs.length} unique story arc(s) for volume ID ${volumeId}:`
									);
									uniqueStoryArcs.forEach((arc: any) => {
										console.log(
											`- ${arc.name} (ID: ${arc.id}) with issueDescription and issueImage`
										);
									});

									return uniqueStoryArcs;
								} catch (error) {
									console.error(
										"An error occurred while processing story arcs:",
										error
									);
								}
							} else {
								console.log(
									"No issues found for the specified volume."
								);
							}
						} catch (error) {
							console.error(
								"An error occurred while fetching data from ComicVine:",
								error
							);
						}
					},
				},

				getIssuesForVolume: {
					rest: "POST /getIssuesForVolume",
					async handler(ctx: Context<{ volumeId: number }>) {
						const { volumeId } = ctx.params;
						const issuesUrl = `${CV_BASE_URL}issues/?api_key=${process.env.COMICVINE_API_KEY}`;
						try {
							const response = await axios.get(issuesUrl, {
								params: {
									api_key: process.env.COMICVINE_API_KEY,
									filter: `volume:${volumeId}`,
									format: "json",
									field_list:
										"id,name,image,issue_number,cover_date,description",
									limit: 100,
								},
								headers: {
									Accept: "application/json",
									"User-Agent": "ThreeTwo",
								},
							});

							// Map over the issues to include the year extracted from cover_date
							const issuesWithDescriptionImageAndYear =
								response.data.results.map((issue: any) => {
									const year = issue.cover_date
										? new Date(
												issue.cover_date
										  ).getFullYear()
										: null; // Extract the year from cover_date
									return {
										...issue,
										year: year,
										description: issue.description || "",
										image: issue.image || {},
									};
								});

							return issuesWithDescriptionImageAndYear;
						} catch (error) {
							this.logger.error(
								"Error fetching issues from ComicVine:",
								error.message
							);
							throw new MoleculerError(
								"Failed to fetch issues",
								500,
								"FETCH_ERROR",
								{ error: error.message }
							);
						}
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
