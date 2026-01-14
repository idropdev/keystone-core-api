import { Injectable, Logger } from '@nestjs/common';
import fs from 'node:fs/promises';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import Handlebars from 'handlebars';
import { AllConfigType } from '../config/config.type';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly isDevelopment: boolean;

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    this.transporter = nodemailer.createTransport({
      host: configService.get('mail.host', { infer: true }),
      port: configService.get('mail.port', { infer: true }),
      ignoreTLS: configService.get('mail.ignoreTLS', { infer: true }),
      secure: configService.get('mail.secure', { infer: true }),
      requireTLS: configService.get('mail.requireTLS', { infer: true }),
      auth: {
        user: configService.get('mail.user', { infer: true }),
        pass: configService.get('mail.password', { infer: true }),
      },
    });

    this.isDevelopment =
      this.configService.get('app.nodeEnv', { infer: true }) !== 'production';
  }

  async sendMail({
    templatePath,
    context,
    ...mailOptions
  }: nodemailer.SendMailOptions & {
    templatePath: string;
    context: Record<string, unknown>;
  }): Promise<void> {
    try {
      let html: string | undefined;
      if (templatePath) {
        const template = await fs.readFile(templatePath, 'utf-8');
        html = Handlebars.compile(template, {
          strict: true,
        })(context);
      }

      await this.transporter.sendMail({
        ...mailOptions,
        from: mailOptions.from
          ? mailOptions.from
          : `"${this.configService.get('mail.defaultName', {
              infer: true,
            })}" <${this.configService.get('mail.defaultEmail', {
              infer: true,
            })}>`,
        html: mailOptions.html ? mailOptions.html : html,
      });
    } catch (error: any) {
      // Handle connection errors gracefully (e.g., maildev not running in dev/test)
      const errorMessage = error?.message || String(error);
      const isConnectionError =
        errorMessage.includes('ENOTFOUND') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('getaddrinfo');

      if (isConnectionError && this.isDevelopment) {
        // In development/test, log warning instead of throwing
        // This allows tests to run without maildev
        this.logger.warn(
          `[MAIL] Connection error (maildev may not be running): ${errorMessage}`,
        );
        this.logger.warn(
          `[MAIL] Email to ${mailOptions.to} was not sent. This is expected in test/dev environments without maildev.`,
        );
        // Don't throw - allow the application to continue
        return;
      }

      // In production or non-connection errors, log and rethrow
      this.logger.error(
        `[MAIL] Failed to send email to ${mailOptions.to}: ${errorMessage}`,
      );
      throw error;
    }
  }
}
