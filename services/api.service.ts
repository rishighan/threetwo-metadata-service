import { Service, ServiceBroker } from "moleculer";
import ApiGateway from "moleculer-web";

export default class ApiService extends Service {
	public constructor(broker: ServiceBroker) {
		super(broker);
		// @ts-ignore
		this.parseServiceSchema({
			name: "api",
			mixins: [ApiGateway],
			// More info about settings: https://moleculer.services/docs/0.14/moleculer-web.html
			settings: {
				port: process.env.PORT || 3080,

				routes: [
					{
						path: "/api",
						whitelist: ["**"],
						use: [],
						mergeParams: true,
						cors: {
							origin: "*",
							methods: [
								"GET",
								"OPTIONS",
								"POST",
								"PUT",
								"DELETE",
							],
							allowedHeaders: ["*"],
							exposedHeaders: [],
							credentials: false,
							maxAge: 3600,
						},

						authentication: false,
						authorization: false,
						autoAliases: true,

						aliases: {},
						callingOptions: {},

						bodyParsers: {
							json: {
								strict: false,
								limit: "1MB",
							},
							urlencoded: {
								extended: true,
								limit: "1MB",
							},
						},
						mappingPolicy: "all", // Available values: "all", "restrict"

						// Enable/disable logging
						logging: true,
					},
					// GraphQL Gateway endpoint with schema stitching
					{
						path: "/graphql",
						whitelist: ["gateway.query"],
						cors: {
							origin: "*",
							methods: ["GET", "POST", "OPTIONS"],
							allowedHeaders: ["*"],
							exposedHeaders: [],
							credentials: false,
							maxAge: 3600,
						},
						aliases: {
							"POST /": async (req: any, res: any) => {
								try {
									const { query, variables, operationName } = req.body;

									const result = await req.$ctx.broker.call("gateway.query", {
										query,
										variables,
										operationName,
									});

									res.setHeader("Content-Type", "application/json");
									res.end(JSON.stringify(result));
								} catch (error: any) {
									res.statusCode = 500;
									res.setHeader("Content-Type", "application/json");
									res.end(JSON.stringify({
										errors: [{
											message: error.message,
											extensions: {
												code: error.code || "INTERNAL_SERVER_ERROR",
											},
										}],
									}));
								}
							},
							"GET /": async (req: any, res: any) => {
								// Support GraphQL Playground/introspection via GET
								const query = req.$params.query;
								const variables = req.$params.variables
									? JSON.parse(req.$params.variables)
									: undefined;
								const operationName = req.$params.operationName;

								try {
									const result = await req.$ctx.broker.call("gateway.query", {
										query,
										variables,
										operationName,
									});

									res.setHeader("Content-Type", "application/json");
									res.end(JSON.stringify(result));
								} catch (error: any) {
									res.statusCode = 500;
									res.setHeader("Content-Type", "application/json");
									res.end(JSON.stringify({
										errors: [{
											message: error.message,
											extensions: {
												code: error.code || "INTERNAL_SERVER_ERROR",
											},
										}],
									}));
								}
							},
						},
						bodyParsers: {
							json: {
								strict: false,
								limit: "1MB",
							},
						},
						mappingPolicy: "restrict",
						logging: true,
					},
					// Standalone metadata GraphQL endpoint (no stitching)
					// This endpoint exposes only the local metadata schema for external services to stitch
					{
						path: "/metadata-graphql",
						whitelist: ["gateway.queryLocal"],
						cors: {
							origin: "*",
							methods: ["GET", "POST", "OPTIONS"],
							allowedHeaders: ["*"],
							exposedHeaders: [],
							credentials: false,
							maxAge: 3600,
						},
						aliases: {
							"POST /": async (req: any, res: any) => {
								try {
									const { query, variables, operationName } = req.body;

									const result = await req.$ctx.broker.call("gateway.queryLocal", {
										query,
										variables,
										operationName,
									});

									res.setHeader("Content-Type", "application/json");
									res.end(JSON.stringify(result));
								} catch (error: any) {
									res.statusCode = 500;
									res.setHeader("Content-Type", "application/json");
									res.end(JSON.stringify({
										errors: [{
											message: error.message,
											extensions: {
												code: error.code || "INTERNAL_SERVER_ERROR",
											},
										}],
									}));
								}
							},
							"GET /": async (req: any, res: any) => {
								// Support GraphQL Playground/introspection via GET
								const query = req.$params.query;
								const variables = req.$params.variables
									? JSON.parse(req.$params.variables)
									: undefined;
								const operationName = req.$params.operationName;

								try {
									const result = await req.$ctx.broker.call("gateway.queryLocal", {
										query,
										variables,
										operationName,
									});

									res.setHeader("Content-Type", "application/json");
									res.end(JSON.stringify(result));
								} catch (error: any) {
									res.statusCode = 500;
									res.setHeader("Content-Type", "application/json");
									res.end(JSON.stringify({
										errors: [{
											message: error.message,
											extensions: {
												code: error.code || "INTERNAL_SERVER_ERROR",
											},
										}],
									}));
								}
							},
						},
						bodyParsers: {
							json: {
								strict: false,
								limit: "1MB",
							},
						},
						mappingPolicy: "restrict",
						logging: true,
					},
				],
				// Do not log client side errors (does not log an error response when the error.code is 400<=X<500)
				log4XXResponses: false,
				// Logging the request parameters. Set to any log level to enable it. E.g. "info"
				logRequestParams: null,
				logResponseData: null,
				assets: {
					folder: "public",
					options: {},
				},
			},

			methods: {
				/**
				 * Authenticate the request. It checks the `Authorization` token value in the request header.
				 * Check the token value & resolve the user by the token.
				 * The resolved user will be available in `ctx.meta.user`
				 *
				 * PLEASE NOTE, IT'S JUST AN EXAMPLE IMPLEMENTATION. DO NOT USE IN PRODUCTION!
				 *
				 * @param {Context} ctx
				 * @param {any} route
				 * @param {IncomingMessage} req
				 * @returns {Promise}

				async authenticate (ctx: Context, route: any, req: IncomingMessage): Promise < any >  => {
					// Read the token from header
					const auth = req.headers.authorization;

					if (auth && auth.startsWith("Bearer")) {
						const token = auth.slice(7);

						// Check the token. Tip: call a service which verify the token. E.g. `accounts.resolveToken`
						if (token === "123456") {
							// Returns the resolved user. It will be set to the `ctx.meta.user`
							return {
								id: 1,
								name: "John Doe",
							};

						} else {
							// Invalid token
							throw new ApiGateway.Errors.UnAuthorizedError(ApiGateway.Errors.ERR_INVALID_TOKEN, {
								error: "Invalid Token",
							});
						}

					} else {
						// No token. Throw an error or do nothing if anonymous access is allowed.
						// Throw new E.UnAuthorizedError(E.ERR_NO_TOKEN);
						return null;
					}
				},
				 */
				/**
				 * Authorize the request. Check that the authenticated user has right to access the resource.
				 *
				 * PLEASE NOTE, IT'S JUST AN EXAMPLE IMPLEMENTATION. DO NOT USE IN PRODUCTION!
				 *
				 * @param {Context} ctx
				 * @param {Object} route
				 * @param {IncomingMessage} req
				 * @returns {Promise}

				async authorize (ctx: Context < any, {
					user: string;
				} > , route: Record<string, undefined>, req: IncomingMessage): Promise < any > => {
					// Get the authenticated user.
					const user = ctx.meta.user;

					// It check the `auth` property in action schema.
					// @ts-ignore
					if (req.$action.auth === "required" && !user) {
						throw new ApiGateway.Errors.UnAuthorizedError("NO_RIGHTS", {
							error: "Unauthorized",
						});
					}
				},
				 */
			},
		});
	}
}
