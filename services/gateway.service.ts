import { Service, ServiceBroker } from "moleculer";
import { ApolloServer } from "@apollo/server";
import { stitchSchemas } from "@graphql-tools/stitch";
import { wrapSchema } from "@graphql-tools/wrap";
import { print, getIntrospectionQuery, buildClientSchema } from "graphql";
import { AsyncExecutor } from "@graphql-tools/utils";
import axios from "axios";
import { typeDefs } from "../models/graphql/typedef";
import { resolvers } from "../models/graphql/resolvers";

/**
 * GraphQL Gateway Service with Schema Stitching
 * Combines the local metadata schema with the remote GraphQL server on port 3000
 */
export default class GatewayService extends Service {
	private apolloServer?: ApolloServer;
	private remoteGraphQLUrl = process.env.REMOTE_GRAPHQL_URL || "http://localhost:3000/graphql";

	public constructor(broker: ServiceBroker) {
		super(broker);

		this.parseServiceSchema({
			name: "gateway",

			settings: {
				// Gateway endpoint path
				path: "/graphql",
				remoteGraphQLUrl: process.env.REMOTE_GRAPHQL_URL || "http://localhost:3000/graphql",
			},

			actions: {
				/**
				 * Execute a GraphQL query through the stitched schema
				 */
				query: {
					params: {
						query: "string",
						variables: { type: "object", optional: true },
						operationName: { type: "string", optional: true },
					},
					async handler(ctx: any) {
						try {
							if (!this.apolloServer) {
								throw new Error("Apollo Gateway Server not initialized");
							}

							const { query, variables, operationName } = ctx.params;

							this.logger.debug("Executing GraphQL query through gateway:", {
								operationName,
								variables,
							});

							const response = await this.apolloServer.executeOperation(
								{
									query,
									variables,
									operationName,
								},
								{
									contextValue: {
										broker: this.broker,
										ctx,
									},
								}
							);

							if (response.body.kind === "single") {
								return response.body.singleResult;
							}

							return response;
						} catch (error) {
							this.logger.error("GraphQL gateway query error:", error);
							throw error;
						}
					},
				},

				/**
				 * Get stitched schema information
				 */
				getSchema: {
					async handler() {
						return {
							message: "Stitched schema combining local metadata service and remote GraphQL server",
							remoteUrl: this.settings.remoteGraphQLUrl,
						};
					},
				},
			},

			methods: {
				/**
				 * Create an executor for the remote GraphQL server
				 */
				createRemoteExecutor(): AsyncExecutor {
					const remoteUrl = this.settings.remoteGraphQLUrl;
					const logger = this.logger;

					return async ({ document, variables, context }) => {
						const query = print(document);
						
						logger.debug(`Executing remote query to ${remoteUrl}`);

						try {
							const response = await axios.post(
								remoteUrl,
								{
									query,
									variables,
								},
								{
									headers: {
										"Content-Type": "application/json",
									},
									timeout: 30000, // 30 second timeout
								}
							);

							return response.data;
						} catch (error: any) {
							logger.error("Remote GraphQL execution error:", error.message);
							
							// Return a GraphQL-formatted error
							return {
								errors: [
									{
										message: `Failed to execute query on remote server: ${error.message}`,
										extensions: {
											code: "REMOTE_GRAPHQL_ERROR",
											remoteUrl,
										},
									},
								],
							};
						}
					};
				},

				/**
				 * Initialize Apollo Server with stitched schema
				 */
				async initApolloGateway() {
					this.logger.info("Initializing Apollo Gateway with Schema Stitching...");

					try {
						// Create executor for remote schema
						const remoteExecutor = this.createRemoteExecutor();

						// Try to introspect the remote schema
						let remoteSchema;
						try {
							this.logger.info(`Attempting to introspect remote schema at ${this.remoteGraphQLUrl}`);
							
							// Manually introspect the remote schema
							const introspectionQuery = getIntrospectionQuery();
							const introspectionResult = await remoteExecutor({
								document: { kind: 'Document', definitions: [] } as any,
								variables: {},
								context: {},
							});

							// Fetch introspection via direct query
							const response = await axios.post(
								this.remoteGraphQLUrl,
								{ query: introspectionQuery },
								{
									headers: { "Content-Type": "application/json" },
									timeout: 30000,
								}
							);

							if (response.data.errors) {
								throw new Error(`Introspection failed: ${JSON.stringify(response.data.errors)}`);
							}

							remoteSchema = buildClientSchema(response.data.data);
							this.logger.info("Successfully introspected remote schema");
						} catch (error: any) {
							this.logger.warn(
								`Could not introspect remote schema at ${this.remoteGraphQLUrl}: ${error.message}`
							);
							this.logger.warn("Gateway will start with local schema only. Remote schema will be unavailable.");
							remoteSchema = null;
						}

						// Create local executable schema
						const { makeExecutableSchema } = await import("@graphql-tools/schema");
						const localSchema = makeExecutableSchema({
							typeDefs,
							resolvers: {
								Query: {
									...resolvers.Query,
								},
								Mutation: {
									...resolvers.Mutation,
								},
								JSON: resolvers.JSON,
							},
						});

						// Stitch schemas together
						let stitchedSchema;
						if (remoteSchema) {
							this.logger.info("Stitching local and remote schemas together...");
							stitchedSchema = stitchSchemas({
								subschemas: [
									{
										schema: localSchema,
										executor: async ({ document, variables, context }) => {
											// Execute local queries through Moleculer broker
											const query = print(document);
											const broker = context?.broker || this.broker;

											// Parse the query to determine which resolver to call
											// For now, we'll execute through the local resolvers directly
											const result = await this.executeLocalQuery(query, variables, context);
											return result;
										},
									},
									{
										schema: remoteSchema,
										executor: remoteExecutor,
									},
								],
								mergeTypes: true, // Merge types with the same name
							});
							this.logger.info("Schema stitching completed successfully");
						} else {
							this.logger.info("Using local schema only (remote unavailable)");
							stitchedSchema = localSchema;
						}

						// Create Apollo Server with stitched schema
						this.apolloServer = new ApolloServer({
							schema: stitchedSchema,
							introspection: true,
							formatError: (error) => {
								this.logger.error("GraphQL Gateway Error:", error);
								return {
									message: error.message,
									locations: error.locations,
									path: error.path,
									extensions: {
										code: error.extensions?.code,
										stacktrace:
											process.env.NODE_ENV === "development"
												? error.extensions?.stacktrace
												: undefined,
									},
								};
							},
						});

						await this.apolloServer.start();
						this.logger.info("Apollo Gateway Server started successfully");
					} catch (error: any) {
						this.logger.error("Failed to initialize Apollo Gateway:", error);
						throw error;
					}
				},

				/**
				 * Execute local queries through Moleculer actions
				 */
				async executeLocalQuery(query: string, variables: any, context: any) {
					// This is a simplified implementation
					// In production, you'd want more sophisticated query parsing
					const broker = context?.broker || this.broker;

					// Determine which action to call based on the query
					// This is a basic implementation - you may need to enhance this
					if (query.includes("searchComicVine")) {
						const result = await broker.call("comicvine.search", variables.input);
						return { data: { searchComicVine: result } };
					} else if (query.includes("volumeBasedSearch")) {
						const result = await broker.call("comicvine.volumeBasedSearch", variables.input);
						return { data: { volumeBasedSearch: result } };
					} else if (query.includes("getIssuesForSeries")) {
						const result = await broker.call("comicvine.getIssuesForSeries", {
							comicObjectId: variables.comicObjectId,
						});
						return { data: { getIssuesForSeries: result } };
					} else if (query.includes("getWeeklyPullList")) {
						const result = await broker.call("comicvine.getWeeklyPullList", variables.input);
						return { data: { getWeeklyPullList: result } };
					} else if (query.includes("getVolume")) {
						const result = await broker.call("comicvine.getVolume", variables.input);
						return { data: { getVolume: result } };
					} else if (query.includes("fetchMetronResource")) {
						const result = await broker.call("metron.fetchResource", variables.input);
						return { data: { fetchMetronResource: result } };
					}

					return { data: null };
				},

				/**
				 * Stop Apollo Gateway Server
				 */
				async stopApolloGateway() {
					if (this.apolloServer) {
						this.logger.info("Stopping Apollo Gateway Server...");
						await this.apolloServer.stop();
						this.apolloServer = undefined;
						this.logger.info("Apollo Gateway Server stopped");
					}
				},
			},

			/**
			 * Service lifecycle hooks
			 */
			started: async function (this: any) {
				await this.initApolloGateway();
			},

			stopped: async function (this: any) {
				await this.stopApolloGateway();
			},
		});
	}
}
