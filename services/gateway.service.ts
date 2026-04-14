import { Service, ServiceBroker } from "moleculer";
import { ApolloServer } from "@apollo/server";
import { stitchSchemas } from "@graphql-tools/stitch";
import { print, getIntrospectionQuery, buildClientSchema } from "graphql";
import { AsyncExecutor } from "@graphql-tools/utils";
import axios from "axios";
import { typeDefs } from "../models/graphql/typedef";
import { resolvers } from "../models/graphql/resolvers";

/**
 * GraphQL Gateway Service with Schema Stitching
 * Combines the local metadata schema with the remote GraphQL server
 */
export default class GatewayService extends Service {
	private apolloServer?: ApolloServer;
	private localApolloServer?: ApolloServer;

	public constructor(broker: ServiceBroker) {
		super(broker);

		this.parseServiceSchema({
			name: "gateway",

			settings: {
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
						if (!this.apolloServer) {
							throw new Error("Apollo Gateway Server not initialized");
						}

						const { query, variables, operationName } = ctx.params;

						const response = await this.apolloServer.executeOperation(
							{ query, variables, operationName },
							{ contextValue: { broker: this.broker, ctx } }
						);

						return response.body.kind === "single" ? response.body.singleResult : response;
					},
				},

				/**
				 * Execute a GraphQL query against local metadata schema only
				 */
				queryLocal: {
					params: {
						query: "string",
						variables: { type: "object", optional: true },
						operationName: { type: "string", optional: true },
					},
					async handler(ctx: any) {
						if (!this.localApolloServer) {
							throw new Error("Local Apollo Server not initialized");
						}

						const { query, variables, operationName } = ctx.params;

						const response = await this.localApolloServer.executeOperation(
							{ query, variables, operationName },
							{ contextValue: { broker: this.broker, ctx } }
						);

						return response.body.kind === "single" ? response.body.singleResult : response;
					},
				},
			},

			methods: {
				/**
				 * Create an executor for the remote GraphQL server
				 */
				createRemoteExecutor(): AsyncExecutor {
					const remoteUrl = this.settings.remoteGraphQLUrl;

					return async ({ document, variables }) => {
						try {
							const response = await axios.post(
								remoteUrl,
								{ query: print(document), variables },
								{ headers: { "Content-Type": "application/json" }, timeout: 30000 }
							);
							return response.data;
						} catch (error: any) {
							return {
								errors: [{
									message: `Remote server error: ${error.message}`,
									extensions: { code: "REMOTE_GRAPHQL_ERROR" },
								}],
							};
						}
					};
				},

				/**
				 * Initialize Apollo Server with stitched schema
				 */
				async initApolloGateway() {
					this.logger.info("Initializing Apollo Gateway...");

					const { makeExecutableSchema } = await import("@graphql-tools/schema");
					const { execute } = await import("graphql");

					// Create local schema
					const localSchema = makeExecutableSchema({ typeDefs, resolvers });

					// Create standalone local Apollo Server for /metadata-graphql endpoint
					this.localApolloServer = new ApolloServer({ schema: localSchema, introspection: true });
					await this.localApolloServer.start();
					this.logger.info("Local metadata Apollo Server started");

					// Create local executor
					const localExecutor: AsyncExecutor = async ({ document, variables, context }) => execute({
							schema: localSchema,
							document,
							variableValues: variables,
							contextValue: { broker: context?.broker || this.broker, ctx: context?.ctx },
						}) as any;

					// Try to introspect remote schema
					let remoteSchema = null;
					try {
						const response = await axios.post(
							this.settings.remoteGraphQLUrl,
							{ query: getIntrospectionQuery() },
							{ headers: { "Content-Type": "application/json" }, timeout: 30000 }
						);

						if (!response.data.errors) {
							remoteSchema = buildClientSchema(response.data.data);
							this.logger.info("Remote schema introspected successfully");
						}
					} catch (error: any) {
						this.logger.warn(`Remote schema unavailable: ${error.message}`);
					}

					// Stitch schemas or use local only
					const schema = remoteSchema
						? stitchSchemas({
								subschemas: [
									{ schema: localSchema, executor: localExecutor },
									{ schema: remoteSchema, executor: this.createRemoteExecutor() },
								],
								mergeTypes: false,
							})
						: localSchema;

					this.apolloServer = new ApolloServer({ schema, introspection: true });
					await this.apolloServer.start();
					this.logger.info("Apollo Gateway started");
				},

				/**
				 * Stop Apollo Gateway Server
				 */
				async stopApolloGateway() {
					if (this.localApolloServer) {
						await this.localApolloServer.stop();
						this.localApolloServer = undefined;
					}
					if (this.apolloServer) {
						await this.apolloServer.stop();
						this.apolloServer = undefined;
					}
				},
			},

			/**
			 * Service lifecycle hooks
			 */
			async started() {
				await this.initApolloGateway();
			},

			async stopped() {
				await this.stopApolloGateway();
			},
		});
	}
}
