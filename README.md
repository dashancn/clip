# i41 临时剪贴板

免登录、客户端加密、自动过期的跨设备临时文本剪贴板。

## 安全设计

- 浏览器使用 PBKDF2-SHA256（210,000次）从用户密码派生 AES-256-GCM密钥
- Worker和KV只接收密文、IV和Salt
- 密码不上传
- 6位不易混淆提取码
- 10分钟至24小时自动过期
- 1至10次读取限制
- 可选阅后即焚
- 创建者拥有独立删除凭证
- 单条密文最大约300KB
- 创建和查询均有应用层IP限流
- API响应使用 no-store、CSP及禁止嵌入等安全响应头

注意：客户端加密不能防止部署者以后篡改页面脚本。请只使用官方HTTPS域名，并通过可信渠道单独发送密码。

## 开发

```bash
npm install
npm test
npm run dev
```

## 部署

```bash
npx wrangler kv namespace create CLIPS
# 将返回的ID写入 wrangler.jsonc
npm run deploy
```

建议生产环境额外配置Cloudflare WAF速率限制和Turnstile。

## 许可证

[MIT License](LICENSE)
