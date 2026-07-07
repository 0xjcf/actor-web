import type { PongSnapshot } from '../pong-contract';
import { PONG_FIELD } from '../pong-contract';

export function drawPong(canvas: HTMLCanvasElement, snapshot: PongSnapshot): void {
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }

  const scaleX = canvas.width / PONG_FIELD.width;
  const scaleY = canvas.height / PONG_FIELD.height;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#07120f';
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = '#315b52';
  context.lineWidth = 2;
  context.setLineDash([8, 12]);
  context.beginPath();
  context.moveTo(canvas.width / 2, 0);
  context.lineTo(canvas.width / 2, canvas.height);
  context.stroke();
  context.setLineDash([]);

  context.fillStyle = '#d7f8ef';
  context.fillRect(
    PONG_FIELD.paddleMargin * scaleX,
    snapshot.paddles.left.y * scaleY,
    PONG_FIELD.paddleWidth * scaleX,
    snapshot.paddles.left.height * scaleY
  );
  context.fillRect(
    (PONG_FIELD.width - PONG_FIELD.paddleMargin - PONG_FIELD.paddleWidth) * scaleX,
    snapshot.paddles.right.y * scaleY,
    PONG_FIELD.paddleWidth * scaleX,
    snapshot.paddles.right.height * scaleY
  );

  context.fillStyle = '#f7c948';
  context.beginPath();
  context.arc(
    snapshot.ball.x * scaleX,
    snapshot.ball.y * scaleY,
    snapshot.ball.radius * Math.min(scaleX, scaleY),
    0,
    Math.PI * 2
  );
  context.fill();

  context.fillStyle = '#e9fff8';
  context.font = '700 28px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  context.textAlign = 'center';
  context.fillText(`${snapshot.score.left}`, canvas.width / 2 - 48, 42);
  context.fillText(`${snapshot.score.right}`, canvas.width / 2 + 48, 42);
}
