import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyPlugin from "fastify-plugin";
import { mercurius } from "mercurius";
import type {
	CurrentClient,
	ExplicitAuthenticationTokenPayload,
	ExplicitGraphQLContext,
} from "~/src/graphql/context";
import { schema } from "~/src/graphql/schema";

/**
 * Type of the initial context argument provided to the createContext function by the graphql server.
 */
type InitialContext = {
	fastify: FastifyInstance;
	request: FastifyRequest;
} & (
	| {
			/**
			 * This field is `false` if the current graphql operation isn't a subscription.
			 */
			isSubscription: false;
			/**
			 * This field is only present if the current graphql operation isn't a subscription.
			 */
			reply: FastifyReply;
			socket?: never;
	  }
	| {
			/**
			 * This field is `true` if the current graphql operation is a subscription.
			 */
			isSubscription: true;
			reply?: never;
			/**
			 * This field is only present if the current graphql operation is a subscription.
			 */
			socket: WebSocket;
	  }
);

export type CreateContext = (
	initialContext: InitialContext,
) => Promise<ExplicitGraphQLContext>;

/**
 * This function is used to create the explicit context passed to the graphql resolvers each time they resolve a graphql operation at runtime. All the transport protocol specific information should be dealt with within this function and the return type of this function must be transport protocol agnostic.
 */
export const createContext: CreateContext = async (initialContext) => {
	const { fastify, request } = initialContext;

	let currentClient: CurrentClient;
	try {
		const jwtPayload =
			await request.jwtVerify<ExplicitAuthenticationTokenPayload>();
		currentClient = {
			isAuthenticated: true,
			user: jwtPayload.user,
		};
	} catch (error) {
		currentClient = {
			isAuthenticated: false,
		};
	}

	return {
		currentClient,
		drizzleClient: fastify.drizzleClient,
		jwt: {
			sign: (payload: ExplicitAuthenticationTokenPayload) =>
				fastify.jwt.sign(payload),
		},
		log: fastify.log,
	};
};

/**
 * This fastify route plugin function is initializes mercurius on the fastify instance and directs incoming requests on the `/graphql` route to it.
 */
export const graphql = fastifyPlugin(async (fastify) => {
	// More information at this link: https://mercurius.dev/#/docs/api/options?id=mercurius
	fastify.register(mercurius, {
		context: (request, reply) =>
			createContext({
				fastify,
				isSubscription: false,
				request,
				reply,
			}),
		graphiql: {
			enabled: fastify.envConfig.API_IS_GRAPHIQL,
		},
		path: "/graphql",
		schema,
		subscription: {
			context: async (socket, request) =>
				await createContext({
					fastify,
					isSubscription: true,
					request,
					socket,
				}),
			// Intervals in milli-seconds to wait before sending the `GQL_CONNECTION_KEEP_ALIVE` message to the client to check if the connection is alive. This helps detect disconnected subscription clients and prevent unnecessary data transfer.
			keepAlive: 1000 * 30,
			//  A function which can be used to validate the `connection_init` payload. It should return a truthy value to authorize the connection. If it returns an object the subscription context will be extended with the returned object.
			onConnect: (data) => {
				return true;
			},
			// A function which is called with the subscription context of the connection after the connection gets disconnected.
			onDisconnect: (ctx) => {},
			// This function is used to validate incoming Websocket connections.
			verifyClient: (info, next) => {
				next(true);
			},
		},
	});
});

export default graphql;
