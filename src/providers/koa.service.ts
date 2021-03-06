import * as _                      from 'underscore';
import * as Koa                    from 'koa';
import * as Router                 from 'koa-router';

import * as logger                 from '@nodeswork/logger';

import { Service }                 from '../service';
import { ModuleService }           from './module.service';
import { Token, beanProvider }     from '../injection';
import {
  MIDDLEWARE,
  Middleware,
  MiddlewareProvider,
  MIDDLEWARE_TARGET_APP,
  MIDDLEWARE_TARGET_ROUTER,
}                                  from '../middleware';
import {
  HANDLER,
  Handler,
  Endpoint,
  EndpointMetadata,
}                                  from '../handler';
import {
  INPUT,
  RawInput,
  InputProvider,
}                                  from '../input';

const LOG = logger.getLogger();

@Service()
export class KoaService {

  public app:    Koa     = new Koa();
  public router: Router  = new Router();

  constructor(
    private modules: ModuleService,
    @Token(MIDDLEWARE) private middlewareProviders: MiddlewareProvider[],
    @Token(HANDLER)    private handlers:            Handler[],
    @Token(INPUT)      private inputProviders:      InputProvider[],
  ) {
    const data: MiddlewareData[] = _.map(
      this.middlewareProviders, (provider) => {
        return {
          provider,
          middlewares: provider.$getMiddlewares(),
        };
      },
    );
    this.registerPreMiddlewares(data);

    this.registerHandlers();

    this.app
      .use(this.router.routes())
      .use(this.router.allowedMethods())
    ;
    this.registerPostMiddlewares(data);
  }

  private registerHandlers() {
    const self = this;

    function register(handlerName: string, endpoint: EndpointMetadata) {
      _.defaults(endpoint, { method: 'GET' });
      self.router.register(
        endpoint.path,
        _.flatten([ endpoint.method ]),
        async (ctx: Router.IRouterContext) => {
          const rawInputs: RawInput[] = _.flatten(_.map(
            self.inputProviders,
            (provider) => provider.$generateInputs(ctx),
          ));
          const inputs = _.map(rawInputs, (rawInput) => {
            const input = beanProvider.getBean(rawInput.type);
            _.extend(input, rawInput.data);
            return input;
          });
          const handler: Handler = beanProvider.getBean(handlerName, inputs);
          ctx.body = await (handler as any)[endpoint.name](ctx);
        }
      );
      LOG.info('Register router path', endpoint);
    }

    for (const handler of this.handlers) {
      const endpoints = handler.$getEndpoints();
      for (const endpoint of endpoints) {
        register(handler.constructor.name, endpoint);
      }
    }
  }

  private registerPreMiddlewares(data: MiddlewareData[]) {
    for (const { provider, middlewares } of data) {
      for (const middleware of middlewares) {
        if (middleware.target === MIDDLEWARE_TARGET_APP && !middleware.later) {
          this.app.use(middleware.fn.bind(provider));
          LOG.info(
            'Use App middleware', _.pick(middleware, 'provider', 'name'),
          );
        }
      }
    }

    for (const { provider, middlewares } of data) {
      for (const middleware of middlewares) {
        if (middleware.target === MIDDLEWARE_TARGET_ROUTER && !middleware.later) {
          this.router.use(middleware.fn.bind(provider));
          LOG.info(
            'Use Router middleware', _.pick(middleware, 'provider', 'name'),
          );
        }
      }
    }
  }

  private registerPostMiddlewares(data: MiddlewareData[]) {
    for (const { provider, middlewares } of data) {
      for (const middleware of middlewares) {
        if (middleware.target === MIDDLEWARE_TARGET_ROUTER && middleware.later) {
          this.router.use(middleware.fn.bind(provider));
          LOG.info(
            'Use Router middleware', _.pick(middleware, 'provider', 'name'),
          );
        }
      }
    }

    for (const { provider, middlewares } of data) {
      for (const middleware of middlewares) {
        if (middleware.target === MIDDLEWARE_TARGET_APP && middleware.later) {
          this.app.use(middleware.fn.bind(provider));
          LOG.info(
            'Use App middleware', _.pick(middleware, 'provider', 'name'),
          );
        }
      }
    }
  }
}

interface MiddlewareData {
  provider:     MiddlewareProvider;
  middlewares:  Middleware[];
}
