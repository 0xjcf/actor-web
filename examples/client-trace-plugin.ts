import type { Connect, Plugin, ViteDevServer } from 'vite';
import { acceptClientTraceBody, clientTraceBootstrapSource, clientTracePath } from './client-trace';

const bodyLimit = 8000;

function readBody(request: Connect.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buffer.length;
      if (size > limit) {
        reject(new Error('client trace body is too large'));
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

export function clientTracePlugin(): Plugin {
  return {
    name: 'actor-web-client-trace',
    apply: 'serve',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (html.includes('__ACTOR_WEB_CLIENT_TRACE__')) {
          return html;
        }
        const tag = `<script>${clientTraceBootstrapSource()}</script>`;
        return html.replace('<head>', `<head>\n    ${tag}`);
      },
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (request, response, next) => {
        const url = request.url ? new URL(request.url, 'http://127.0.0.1') : null;
        if (url?.pathname !== clientTracePath) {
          next();
          return;
        }
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.end();
          return;
        }
        try {
          const raw = await readBody(request, bodyLimit);
          const accepted = acceptClientTraceBody(raw);
          if (accepted.level === 'error') {
            server.config.logger.error(accepted.line);
          } else {
            server.config.logger.info(accepted.line);
          }
          response.statusCode = accepted.status;
          response.end();
        } catch (error) {
          server.config.logger.error(
            `[actor-web:client] error dev-server: ${
              error instanceof Error ? error.message : 'client trace failed'
            }`
          );
          response.statusCode = 400;
          response.end();
        }
      });
    },
  };
}
