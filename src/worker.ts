export interface Env {
	DB: D1Database;
	MEDIA: R2Bucket;
}

type User = { id: string; username: string };

type Route = {
	method: string;
	pattern: RegExp;
	handler: (req: Request, env: Env, match: RegExpMatchArray) => Promise<Response>;
};

const routes: Route[] = [
	{ method: 'GET', pattern: /^\/login$/, handler: pageLogin },
	{ method: 'GET', pattern: /^\/register$/, handler: pageRegister },
	{ method: 'POST', pattern: /^\/api\/auth\/login$/, handler: apiLogin },
	{ method: 'POST', pattern: /^\/api\/auth\/register$/, handler: apiRegister },
	{ method: 'POST', pattern: /^\/api\/auth\/logout$/, handler: apiLogout },

	{ method: 'GET', pattern: /^\/$/, handler: pagePosts },
	{ method: 'GET', pattern: /^\/categories$/, handler: pageCategories },
	{ method: 'GET', pattern: /^\/posts\/new$/, handler: pagePostEditorNew },
	{ method: 'GET', pattern: /^\/posts\/([^/]+)$/, handler: pagePostEditorEdit },
	{ method: 'GET', pattern: /^\/media\/([^/]+)$/, handler: getMedia },

	{ method: 'GET', pattern: /^\/api\/posts$/, handler: apiListPosts },
	{ method: 'POST', pattern: /^\/api\/posts$/, handler: apiUpsertPost },
	{ method: 'DELETE', pattern: /^\/api\/posts\/([^/]+)$/, handler: apiDeletePost },

	{ method: 'GET', pattern: /^\/api\/categories$/, handler: apiListCategories },
	{ method: 'POST', pattern: /^\/api\/categories$/, handler: apiCreateCategory },
	{ method: 'DELETE', pattern: /^\/api\/categories\/([^/]+)$/, handler: apiDeleteCategory }
];

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const requestId = uid('req_');
		try {
			const url = new URL(req.url);
			const pathname = url.pathname.replace(/\/+$/, '') || '/';

			// Auth gate: everything except login/register/auth API/media must be authenticated.
			if (requiresAuth(pathname)) {
				const user = await getSessionUser(req, env);
				if (!user) return redirect(`/login?next=${encodeURIComponent(pathname)}`);
				(req as any).__user = user;
			}

			for (const r of routes) {
				if (req.method !== r.method) continue;
				const m = pathname.match(r.pattern);
				if (m) return r.handler(req, env, m);
			}

			if (pathname.startsWith('/assets/')) {
				return new Response('Not found', { status: 404 });
			}

			return new Response('Not found', { status: 404 });
		} catch (err) {
			// Avoid 1101 "uncaught" by always catching and logging.
			console.error('Unhandled error', { requestId, url: req.url, err });
			return jsonResponse({ ok: false, message: 'Internal error', requestId }, 500);
		}
	}
};

function htmlResponse(body: string, status = 200, headers: HeadersInit = {}): Response {
	return new Response(body, {
		status,
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'cache-control': 'no-store',
			...headers
		}
	});
}

function jsonResponse(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders }
	});
}

function badRequest(message: string, details?: unknown): Response {
	return jsonResponse({ ok: false, message, details }, 400);
}

function redirect(location: string, status = 302, headers: HeadersInit = {}): Response {
	return new Response(null, { status, headers: { location, ...headers } });
}

function uid(prefix = ''): string {
	const t = Date.now().toString(36);
	const r = crypto.getRandomValues(new Uint32Array(2));
	return `${prefix}${t}-${r[0].toString(36)}${r[1].toString(36)}`;
}

function slugify(input: string): string {
	return input
		.trim()
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)+/g, '');
}

function layout(opts: {
	title: string;
	active: 'posts' | 'categories' | 'auth';
	content: string;
	pills?: { posts?: number; categories?: number };
	user?: User | null;
}) {
	const { title, active, content, pills, user } = opts;
	const postsPill = pills?.posts ?? '';
	const catPill = pills?.categories ?? '';
	const showSidebar = !!user && active !== 'auth';

	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)} • CMS</title>
    <link rel="stylesheet" href="/app.css" />
    <link rel="preconnect" href="https://cdn.jsdelivr.net" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" />
    <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js"></script>
  </head>
  <body>
    <div class="${showSidebar ? 'app' : ''}" style="${showSidebar ? '' : 'min-height:100vh;display:grid;place-items:center;padding:24px'}">
      ${
				showSidebar
					? `<aside class="sidebar">
        <div class="brand">
          <div>
            <div style="font-size:18px">Dashpilot</div>
            <div class="muted" style="font-weight:600;font-size:12px;margin-top:2px">Blog CMS</div>
          </div>
        </div>

        <div class="nav">
          <div class="nav-section">Explore</div>
          <a href="/" class="${active === 'posts' ? 'active' : ''}">
            <i class="bi bi-journal-text"></i>
            Posts
            ${postsPill !== '' ? `<span class="pill">${postsPill}</span>` : ''}
          </a>
          <a href="/categories" class="${active === 'categories' ? 'active' : ''}">
            <i class="bi bi-tags"></i>
            Categories
            ${catPill !== '' ? `<span class="pill">${catPill}</span>` : ''}
          </a>

          <div class="nav-section">Assets</div>
          <a href="/posts/new">
            <i class="bi bi-plus-circle"></i>
            New Post
          </a>

          ${
						user
							? `
          <div class="nav-section">Account</div>
          <div class="muted" style="padding:6px 12px 10px;font-size:13px">
            Signed in as <strong>${escapeHtml(user.username)}</strong>
          </div>
          <button class="btn" style="width:100%;justify-content:center" onclick="(async()=>{await fetch('/api/auth/logout',{method:'POST'}); location.href='/login';})()">
            <i class="bi bi-box-arrow-right"></i> Logout
          </button>
          `
							: ''
					}
        </div>
      </aside>`
					: ''
			}

      <main class="${showSidebar ? 'main' : ''}" style="${showSidebar ? '' : 'width:min(860px,100%);'}">
        ${content}
      </main>
    </div>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getReqUser(req: Request): User | null {
	return ((req as any).__user as User) ?? null;
}

async function pagePosts(req: Request, env: Env): Promise<Response> {
	const counts = await getCounts(env);
	const user = getReqUser(req);
	const content = `
  <div class="topbar">
    <div>
      <h1 class="h1">My Posts</h1>
      <div class="muted">Write, edit, and organize your content.</div>
    </div>
    <div style="display:flex;gap:10px;align-items:center">
      <a class="btn" href="/categories"><i class="bi bi-tags"></i> Categories</a>
      <a class="btn primary" href="/posts/new"><i class="bi bi-plus-lg"></i> New post</a>
    </div>
  </div>

  <div class="card">
    <div class="card-inner" x-data="postsPage()" x-init="load()">
      <div style="display:flex;gap:12px;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="flex:1;max-width:420px">
          <input class="input" type="search" placeholder="Search posts…" x-model="q" @input.debounce.200ms="applyFilter()" />
        </div>
        <div class="muted" x-text="filtered.length + ' posts'"></div>
      </div>

      <div style="overflow:auto">
        <table class="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Category</th>
              <th>Updated</th>
              <th style="width:140px">Actions</th>
            </tr>
          </thead>
          <tbody>
            <template x-for="p in filtered" :key="p.id">
              <tr>
                <td>
                  <div style="display:flex;gap:10px;align-items:center">
                    <div style="width:10px;height:10px;border-radius:999px;background:rgba(99,102,241,.55)"></div>
                    <a :href="'/posts/' + p.id" style="text-decoration:none;color:inherit;font-weight:700" x-text="p.title"></a>
                  </div>
                </td>
                <td class="muted" x-text="p.category_name || '—'"></td>
                <td class="muted" x-text="new Date(p.updated_at).toLocaleString()"></td>
                <td>
                  <div style="display:flex;gap:8px">
                    <a class="btn" :href="'/posts/' + p.id" title="Edit"><i class="bi bi-pencil"></i></a>
                    <button class="btn" @click="del(p.id)" title="Delete"><i class="bi bi-trash"></i></button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    function postsPage(){
      return {
        posts: [],
        filtered: [],
        q: '',
        async load(){
          const r = await fetch('/api/posts');
          const data = await r.json();
          this.posts = data.posts || [];
          this.applyFilter();
        },
        applyFilter(){
          const q = (this.q || '').toLowerCase().trim();
          this.filtered = !q ? this.posts : this.posts.filter(p =>
            (p.title||'').toLowerCase().includes(q) ||
            (p.category_name||'').toLowerCase().includes(q)
          );
        },
        async del(id){
          if(!confirm('Delete this post?')) return;
          const r = await fetch('/api/posts/' + id, { method: 'DELETE' });
          if(!r.ok){ alert('Failed to delete'); return; }
          this.posts = this.posts.filter(p => p.id !== id);
          this.applyFilter();
        }
      }
    }
  </script>
`;
	return htmlResponse(layout({ title: 'Posts', active: 'posts', content, pills: counts, user }));
}

async function pageCategories(req: Request, env: Env): Promise<Response> {
	const counts = await getCounts(env);
	const user = getReqUser(req);
	const content = `
  <div class="topbar">
    <div>
      <h1 class="h1">Categories</h1>
      <div class="muted">Keep posts organized.</div>
    </div>
    <a class="btn primary" href="/posts/new"><i class="bi bi-plus-lg"></i> New post</a>
  </div>

  <div class="card">
    <div class="card-inner" x-data="categoriesPage()" x-init="load()">
      <div class="grid">
        <div class="col-4">
          <div class="label">New category</div>
          <input class="input" placeholder="e.g. Product updates" x-model="name" />
          <div style="display:flex;gap:10px;margin-top:10px">
            <button class="btn primary" @click="create()" :disabled="busy"><i class="bi bi-plus-circle"></i> Create</button>
          </div>
          <div class="muted" style="margin-top:10px;font-size:13px">Slug is generated automatically.</div>
        </div>
        <div class="col-8">
          <div style="overflow:auto">
            <table class="table">
              <thead>
                <tr><th>Name</th><th>Slug</th><th style="width:140px">Actions</th></tr>
              </thead>
              <tbody>
                <template x-for="c in categories" :key="c.id">
                  <tr>
                    <td style="font-weight:700" x-text="c.name"></td>
                    <td class="muted" x-text="c.slug"></td>
                    <td>
                      <button class="btn" @click="del(c.id)"><i class="bi bi-trash"></i></button>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    function categoriesPage(){
      return {
        categories: [],
        name: '',
        busy: false,
        async load(){
          const r = await fetch('/api/categories');
          const data = await r.json();
          this.categories = data.categories || [];
        },
        async create(){
          const name = (this.name||'').trim();
          if(!name) return;
          this.busy = true;
          try{
            const r = await fetch('/api/categories', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ name })
            });
            const data = await r.json();
            if(!r.ok){ alert(data.message || 'Failed'); return; }
            this.categories.unshift(data.category);
            this.name = '';
          } finally {
            this.busy = false;
          }
        },
        async del(id){
          if(!confirm('Delete this category? Posts will be unassigned.')) return;
          const r = await fetch('/api/categories/' + id, { method: 'DELETE' });
          if(!r.ok){ alert('Failed'); return; }
          this.categories = this.categories.filter(c => c.id !== id);
        }
      }
    }
  </script>
`;
	return htmlResponse(layout({ title: 'Categories', active: 'categories', content, pills: counts, user }));
}

async function pagePostEditorNew(req: Request, env: Env): Promise<Response> {
	return pagePostEditor(req, env, null);
}

async function pagePostEditorEdit(req: Request, env: Env, match: RegExpMatchArray): Promise<Response> {
	const id = match[1];
	return pagePostEditor(req, env, id);
}

async function pagePostEditor(req: Request, env: Env, id: string | null): Promise<Response> {
	const counts = await getCounts(env);
	const user = getReqUser(req);
	const categories = await env.DB.prepare('SELECT id, name FROM categories ORDER BY name ASC').all();

	let post: any = null;
	if (id) {
		const r = await env.DB.prepare(
			`SELECT p.id, p.title, p.body_html, p.category_id, p.image_key, p.image_content_type
       FROM posts p WHERE p.id = ?1`
		)
			.bind(id)
			.first();
		if (!r) return htmlResponse('Not found', 404);
		post = r;
	}

	const title = post ? 'Edit Post' : 'New Post';
	const initJson = JSON.stringify({
		post,
		categories: categories.results ?? []
	}).replace(/</g, '\\u003c');
	const content = `
  <div class="topbar">
    <div>
      <h1 class="h1">${escapeHtml(title)}</h1>
      <div class="muted">${post ? 'Update your post and save.' : 'Draft a new post and publish.'}</div>
    </div>
    <div style="display:flex;gap:10px">
      <a class="btn" href="/"><i class="bi bi-arrow-left"></i> Back</a>
      <button form="postForm" class="btn primary"><i class="bi bi-check2-circle"></i> Save</button>
    </div>
  </div>

  <script type="application/json" id="post-editor-init">${initJson}</script>

  <div class="grid" x-data="postEditor()" x-init="initFromDom()">
    <div class="col-8">
      <div class="card">
        <div class="card-inner">
          <form id="postForm" @submit.prevent="save()">
            <div class="label">Title</div>
            <input class="input" x-model="title" placeholder="A catchy title…" />

            <div class="label">Body</div>
            <div class="editor">
              <div class="toolbar">
                <button type="button" class="tool" :class="{active:isActive('bold')}" @click="cmd('bold')"><i class="bi bi-type-bold"></i></button>
                <button type="button" class="tool" :class="{active:isActive('italic')}" @click="cmd('italic')"><i class="bi bi-type-italic"></i></button>
                <button type="button" class="tool" :class="{active:isActive('underline')}" @click="cmd('underline')"><i class="bi bi-type-underline"></i></button>
                <button type="button" class="tool" @click="cmd('insertUnorderedList')"><i class="bi bi-list-ul"></i></button>
                <button type="button" class="tool" @click="cmd('formatBlock', 'blockquote')"><i class="bi bi-quote"></i></button>
                <button type="button" class="tool" @click="addLink()"><i class="bi bi-link-45deg"></i></button>
              </div>
              <div class="contenteditable" contenteditable="true" x-ref="ed" @input="sync()" @keyup="sync()"></div>
            </div>

            <div style="display:flex;gap:10px;margin-top:14px;align-items:center">
              <button type="submit" class="btn primary" :disabled="busy"><i class="bi bi-save"></i> Save</button>
              <div class="muted" x-show="busy">Saving…</div>
            </div>
          </form>
        </div>
      </div>
    </div>

    <div class="col-4">
      <div class="card">
        <div class="card-inner">
          <div class="label">Category</div>
          <select class="select" x-model="category_id">
            <option value="">Uncategorized</option>
            <template x-for="c in categories" :key="c.id">
              <option :value="c.id" x-text="c.name"></option>
            </template>
          </select>

          <div class="label">Cover image</div>
          <div class="thumb">
            <template x-if="image_url">
              <img :src="image_url" alt="Cover image preview" />
            </template>
            <template x-if="!image_url">
              <div class="muted" style="text-align:center;padding:18px">
                <i class="bi bi-image" style="font-size:26px"></i>
                <div style="margin-top:6px">No image</div>
              </div>
            </template>
          </div>

          <div style="margin-top:10px">
            <input type="file" accept="image/*" @change="pickFile($event)" />
          </div>

          <div class="muted" style="font-size:13px;margin-top:10px">
            Tip: images are stored in R2; the post stores the R2 key.
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    function postEditor(){
      return {
        id: null,
        title: '',
        category_id: '',
        categories: [],
        body_html: '<p></p>',
        image_key: null,
        image_url: null,
        image_file: null,
        busy: false,
        initFromDom(){
          const el = document.getElementById('post-editor-init');
          const init = el ? JSON.parse(el.textContent || '{}') : {};
          this.id = init.post?.id || null;
          this.title = init.post?.title || '';
          this.category_id = init.post?.category_id || '';
          this.categories = init.categories || [];
          this.body_html = init.post?.body_html || '<p></p>';
          this.image_key = init.post?.image_key || null;
          this.image_url = init.post?.image_key ? ('/media/' + init.post.image_key) : null;

          this.$refs.ed.innerHTML = this.body_html;
        },
        sync(){
          this.body_html = this.$refs.ed.innerHTML;
        },
        cmd(name, value){
          document.execCommand(name, false, value);
          this.sync();
        },
        isActive(cmd){
          try { return document.queryCommandState(cmd); } catch(e) { return false; }
        },
        addLink(){
          const href = prompt('Link URL');
          if(!href) return;
          document.execCommand('createLink', false, href);
          this.sync();
        },
        pickFile(e){
          const f = e.target.files?.[0];
          if(!f) return;
          this.image_file = f;
          this.image_url = URL.createObjectURL(f);
        },
        async save(){
          const title = (this.title||'').trim();
          if(!title){ alert('Title is required'); return; }
          this.sync();
          const fd = new FormData();
          if(this.id) fd.set('id', this.id);
          fd.set('title', title);
          fd.set('body_html', this.body_html || '<p></p>');
          if(this.category_id) fd.set('category_id', this.category_id);
          if(this.image_file) fd.set('image', this.image_file);

          this.busy = true;
          try{
            const r = await fetch('/api/posts', { method: 'POST', body: fd });
            const data = await r.json();
            if(!r.ok){ alert(data.message || 'Failed'); return; }
            location.href = '/posts/' + data.post.id;
          } finally {
            this.busy = false;
          }
        }
      }
    }
  </script>
`;
	return htmlResponse(layout({ title, active: 'posts', content, pills: counts, user }));
}

async function getMedia(req: Request, env: Env, match: RegExpMatchArray): Promise<Response> {
	const key = match[1];
	const obj = await env.MEDIA.get(key);
	if (!obj) return new Response('Not found', { status: 404 });

	const headers = new Headers();
	obj.writeHttpMetadata(headers);
	headers.set('etag', obj.httpEtag);
	headers.set('cache-control', 'public, max-age=31536000, immutable');
	return new Response(obj.body, { headers });
}

async function pageLogin(req: Request, env: Env): Promise<Response> {
	const url = new URL(req.url);
	const next = url.searchParams.get('next') || '/';
	const hasUsers = await hasAnyUsers(env);
	const initJson = JSON.stringify({ next, canRegister: !hasUsers }).replace(/</g, '\\u003c');
	const content = `
  <div class="topbar">
    <div>
      <h1 class="h1">Login</h1>
      <div class="muted">Welcome back.</div>
    </div>
  </div>

  <div class="card" style="max-width:720px">
    <script type="application/json" id="auth-login-init">${initJson}</script>
    <div class="card-inner" x-data="authLogin()" x-init="initFromDom()">
      <div class="flash danger" x-show="error" x-text="error" style="display:none"></div>

      <div class="label">Username</div>
      <input class="input" autocomplete="username" x-model="username" />
      <div class="label">Password</div>
      <input class="input" type="password" autocomplete="current-password" x-model="password" @keydown.enter.prevent="login()" />

      <div style="display:flex;gap:10px;margin-top:14px;align-items:center">
        <button class="btn primary" @click="login()" :disabled="busy"><i class="bi bi-box-arrow-in-right"></i> Login</button>
        <div class="muted" x-show="busy">Checking…</div>
        <template x-if="canRegister">
          <a class="btn" :href="'/register?next=' + encodeURIComponent(next)"><i class="bi bi-person-plus"></i> Create first user</a>
        </template>
      </div>
    </div>
  </div>

  <script>
    function authLogin(){
      return {
        username: '',
        password: '',
        busy: false,
        error: '',
        next: '/',
        canRegister: false,
        initFromDom(){
          const el = document.getElementById('auth-login-init');
          const init = el ? JSON.parse(el.textContent || '{}') : {};
          this.next = init.next || '/';
          this.canRegister = !!init.canRegister;
        },
        async login(){
          this.error = '';
          const username = (this.username||'').trim();
          const password = this.password || '';
          if(!username || !password){ this.error = 'Username and password are required.'; return; }
          this.busy = true;
          try{
            const r = await fetch('/api/auth/login', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ username, password })
            });
            const data = await r.json();
            if(!r.ok){ this.error = data.message || 'Login failed.'; return; }
            location.href = this.next || '/';
          } finally {
            this.busy = false;
          }
        }
      }
    }
  </script>
`;
	return htmlResponse(layout({ title: 'Login', active: 'auth', content, user: null }));
}

async function pageRegister(req: Request, env: Env): Promise<Response> {
	const url = new URL(req.url);
	const next = url.searchParams.get('next') || '/';
	const hasUsers = await hasAnyUsers(env);
	if (hasUsers) return redirect('/login');
	const initJson = JSON.stringify({ next }).replace(/</g, '\\u003c');

	const content = `
  <div class="topbar">
    <div>
      <h1 class="h1">Create admin user</h1>
      <div class="muted">Registration is only available for the very first user.</div>
    </div>
  </div>

  <div class="card" style="max-width:720px">
    <script type="application/json" id="auth-register-init">${initJson}</script>
    <div class="card-inner" x-data="authRegister()" x-init="initFromDom()">
      <div class="flash danger" x-show="error" x-text="error" style="display:none"></div>

      <div class="label">Username</div>
      <input class="input" autocomplete="username" x-model="username" />
      <div class="label">Password</div>
      <input class="input" type="password" autocomplete="new-password" x-model="password" />
      <div class="label">Confirm password</div>
      <input class="input" type="password" autocomplete="new-password" x-model="password2" @keydown.enter.prevent="register()" />

      <div style="display:flex;gap:10px;margin-top:14px;align-items:center">
        <button class="btn primary" @click="register()" :disabled="busy"><i class="bi bi-person-check"></i> Create user</button>
        <div class="muted" x-show="busy">Creating…</div>
        <a class="btn" href="/login"><i class="bi bi-arrow-left"></i> Back to login</a>
      </div>
    </div>
  </div>

  <script>
    function authRegister(){
      return {
        username: '',
        password: '',
        password2: '',
        busy: false,
        error: '',
        next: '/',
        initFromDom(){
          const el = document.getElementById('auth-register-init');
          const init = el ? JSON.parse(el.textContent || '{}') : {};
          this.next = init.next || '/';
        },
        async register(){
          this.error = '';
          const username = (this.username||'').trim();
          const password = this.password || '';
          if(!username || !password){ this.error = 'Username and password are required.'; return; }
          if(password.length < 8){ this.error = 'Use at least 8 characters.'; return; }
          if(password !== this.password2){ this.error = 'Passwords do not match.'; return; }
          this.busy = true;
          try{
            const r = await fetch('/api/auth/register', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ username, password })
            });
            const data = await r.json();
            if(!r.ok){ this.error = data.message || 'Registration failed.'; return; }
            location.href = this.next || '/';
          } finally {
            this.busy = false;
          }
        }
      }
    }
  </script>
`;
	return htmlResponse(layout({ title: 'Register', active: 'auth', content, user: null }));
}

async function apiListPosts(req: Request, env: Env): Promise<Response> {
	const r = await env.DB.prepare(
		`SELECT p.id, p.title, p.category_id, c.name AS category_name, p.created_at, p.updated_at
     FROM posts p
     LEFT JOIN categories c ON c.id = p.category_id
     ORDER BY p.updated_at DESC`
	).all();
	return jsonResponse({ ok: true, posts: r.results ?? [] });
}

async function apiUpsertPost(req: Request, env: Env): Promise<Response> {
	const ct = req.headers.get('content-type') || '';
	if (!ct.includes('multipart/form-data')) return badRequest('Expected multipart/form-data');

	const form = await req.formData();
	const id = (form.get('id')?.toString() || '').trim();
	const title = (form.get('title')?.toString() || '').trim();
	const body_html = (form.get('body_html')?.toString() || '').trim();
	const category_id = (form.get('category_id')?.toString() || '').trim() || null;

	if (!title) return badRequest('Title is required');
	if (!body_html) return badRequest('Body is required');

	let postId = id || uid('post_');
	let image_key: string | null = null;
	let image_content_type: string | null = null;

	const image = form.get('image');
	if (image instanceof File && image.size > 0) {
		const ext = guessExt(image.type) || 'bin';
		image_key = `${postId}/${uid('img_')}.${ext}`;
		image_content_type = image.type || 'application/octet-stream';
		await env.MEDIA.put(image_key, image.stream(), {
			httpMetadata: { contentType: image_content_type },
			customMetadata: { postId }
		});
	}

	const existing = await env.DB.prepare('SELECT id, image_key FROM posts WHERE id = ?1').bind(postId).first();

	if (existing) {
		const newImageKey = image_key ?? (existing as any).image_key ?? null;
		const newImageCt = image_key ? image_content_type : null;
		await env.DB.prepare(
			`UPDATE posts
       SET title=?2, body_html=?3, category_id=?4,
           image_key=?5,
           image_content_type=COALESCE(?6, image_content_type),
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id=?1`
		)
			.bind(postId, title, body_html, category_id, newImageKey, newImageCt)
			.run();
	} else {
		await env.DB.prepare(
			`INSERT INTO posts (id, title, body_html, category_id, image_key, image_content_type)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
		)
			.bind(postId, title, body_html, category_id, image_key, image_content_type)
			.run();
	}

	const post = await env.DB.prepare(
		`SELECT id, title, body_html, category_id, image_key, image_content_type, created_at, updated_at
     FROM posts WHERE id=?1`
	)
		.bind(postId)
		.first();

	return jsonResponse({ ok: true, post });
}

async function apiDeletePost(req: Request, env: Env, match: RegExpMatchArray): Promise<Response> {
	const id = match[1];
	const post = await env.DB.prepare('SELECT image_key FROM posts WHERE id=?1').bind(id).first();
	if (!post) return jsonResponse({ ok: true });

	const image_key = (post as any).image_key as string | null;
	await env.DB.prepare('DELETE FROM posts WHERE id=?1').bind(id).run();
	if (image_key) await env.MEDIA.delete(image_key);

	return jsonResponse({ ok: true });
}

async function apiListCategories(req: Request, env: Env): Promise<Response> {
	const r = await env.DB.prepare('SELECT id, name, slug, created_at FROM categories ORDER BY created_at DESC').all();
	return jsonResponse({ ok: true, categories: r.results ?? [] });
}

async function apiRegister(req: Request, env: Env): Promise<Response> {
	const hasUsers = await hasAnyUsers(env);
	if (hasUsers) return jsonResponse({ ok: false, message: 'Registration is disabled.' }, 403);

	let body: any;
	try {
		body = await req.json();
	} catch {
		return badRequest('Expected JSON');
	}
	const username = (body?.username || '').toString().trim();
	const password = (body?.password || '').toString();
	if (!username || !password) return badRequest('Username and password are required');
	if (password.length < 8) return badRequest('Password must be at least 8 characters');

	const userId = uid('usr_');
	const salt = randomBase64(16);
	const hash = await hashPasswordPbkdf2(password, salt);

	try {
		await env.DB.prepare('INSERT INTO users (id, username, password_hash, password_salt) VALUES (?1, ?2, ?3, ?4)')
			.bind(userId, username, hash, salt)
			.run();
	} catch {
		return badRequest('Username is already taken');
	}

	const { sessionId, cookie } = await createSessionCookie(req, env, userId);
	return jsonResponse({ ok: true }, 200, { 'set-cookie': cookie });
}

async function apiLogin(req: Request, env: Env): Promise<Response> {
	let body: any;
	try {
		body = await req.json();
	} catch {
		return badRequest('Expected JSON');
	}
	const username = (body?.username || '').toString().trim();
	const password = (body?.password || '').toString();
	if (!username || !password) return badRequest('Username and password are required');

	const user = await env.DB.prepare('SELECT id, password_hash, password_salt FROM users WHERE username=?1')
		.bind(username)
		.first();
	if (!user) return jsonResponse({ ok: false, message: 'Invalid username or password' }, 401);

	const salt = (user as any).password_salt as string;
	const expected = (user as any).password_hash as string;
	const got = await hashPasswordPbkdf2(password, salt);
	if (!timingSafeEqual(expected, got)) return jsonResponse({ ok: false, message: 'Invalid username or password' }, 401);

	const { cookie } = await createSessionCookie(req, env, (user as any).id as string);
	return jsonResponse({ ok: true }, 200, { 'set-cookie': cookie });
}

async function apiLogout(req: Request, env: Env): Promise<Response> {
	const sessionId = readCookie(req.headers.get('cookie') || '', SESSION_COOKIE);
	if (sessionId) {
		await env.DB.prepare('DELETE FROM sessions WHERE id=?1').bind(sessionId).run();
	}
	return jsonResponse({ ok: true }, 200, { 'set-cookie': clearSessionCookie(req) });
}

async function apiCreateCategory(req: Request, env: Env): Promise<Response> {
	let body: any;
	try {
		body = await req.json();
	} catch {
		return badRequest('Expected JSON');
	}
	const name = (body?.name || '').toString().trim();
	if (!name) return badRequest('Name is required');
	const slug = slugify(name);
	if (!slug) return badRequest('Invalid name');

	const id = uid('cat_');
	try {
		await env.DB.prepare('INSERT INTO categories (id, name, slug) VALUES (?1, ?2, ?3)').bind(id, name, slug).run();
	} catch (e: any) {
		return badRequest('Category already exists', { slug });
	}

	const category = await env.DB.prepare('SELECT id, name, slug, created_at FROM categories WHERE id=?1').bind(id).first();
	return jsonResponse({ ok: true, category });
}

async function apiDeleteCategory(req: Request, env: Env, match: RegExpMatchArray): Promise<Response> {
	const id = match[1];
	await env.DB.prepare('UPDATE posts SET category_id = NULL WHERE category_id = ?1').bind(id).run();
	await env.DB.prepare('DELETE FROM categories WHERE id=?1').bind(id).run();
	return jsonResponse({ ok: true });
}

async function getCounts(env: Env): Promise<{ posts: number; categories: number }> {
	try {
		const [p, c] = await Promise.all([
			env.DB.prepare('SELECT COUNT(1) AS n FROM posts').first(),
			env.DB.prepare('SELECT COUNT(1) AS n FROM categories').first()
		]);
		return { posts: Number((p as any)?.n ?? 0), categories: Number((c as any)?.n ?? 0) };
	} catch (err) {
		// If the remote schema wasn't applied yet, tables may not exist.
		console.error('getCounts failed (missing schema?)', err);
		return { posts: 0, categories: 0 };
	}
}

function guessExt(contentType: string): string | null {
	const ct = contentType.toLowerCase();
	if (ct.includes('image/png')) return 'png';
	if (ct.includes('image/jpeg')) return 'jpg';
	if (ct.includes('image/webp')) return 'webp';
	if (ct.includes('image/gif')) return 'gif';
	if (ct.includes('image/avif')) return 'avif';
	return null;
}

// --- Auth helpers ---

const SESSION_COOKIE = 'cms_session';

function requiresAuth(pathname: string): boolean {
	if (pathname === '/login' || pathname === '/register') return false;
	if (pathname.startsWith('/api/auth/')) return false;
	if (pathname.startsWith('/media/')) return false;
	// allow static assets (wrangler assets)
	if (pathname === '/app.css') return false;
	return true;
}

async function hasAnyUsers(env: Env): Promise<boolean> {
	try {
		const r = await env.DB.prepare('SELECT COUNT(1) AS n FROM users').first();
		return Number((r as any)?.n ?? 0) > 0;
	} catch (err) {
		// Common on first deploy if `schema.sql` wasn't executed against remote D1 yet.
		console.error('hasAnyUsers failed (missing schema?)', err);
		return false;
	}
}

async function getSessionUser(req: Request, env: Env): Promise<User | null> {
	const cookieHeader = req.headers.get('cookie') || '';
	const sessionId = readCookie(cookieHeader, SESSION_COOKIE);
	if (!sessionId) return null;

	// best-effort cleanup
	await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')").run();

	const row = await env.DB.prepare(
		`SELECT u.id AS id, u.username AS username
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ?1 AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
     LIMIT 1`
	)
		.bind(sessionId)
		.first();

	if (!row) return null;
	return { id: (row as any).id, username: (row as any).username };
}

function readCookie(cookieHeader: string, name: string): string | null {
	const parts = cookieHeader.split(/;\s*/g);
	for (const p of parts) {
		const idx = p.indexOf('=');
		if (idx < 0) continue;
		const k = p.slice(0, idx).trim();
		if (k !== name) continue;
		const raw = p.slice(idx + 1);
		try {
			return decodeURIComponent(raw);
		} catch {
			// Malformed cookie values can throw URIError; treat as absent.
			return null;
		}
	}
	return null;
}

function cookieBaseAttrs(req: Request): string {
	const url = new URL(req.url);
	const secure = url.protocol === 'https:' ? '; Secure' : '';
	return `; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function clearSessionCookie(req: Request): string {
	return `${SESSION_COOKIE}=; Max-Age=0${cookieBaseAttrs(req)}`;
}

async function createSessionCookie(req: Request, env: Env, userId: string): Promise<{ sessionId: string; cookie: string }> {
	const sessionId = uid('sess_');
	const ttlSeconds = 60 * 60 * 24 * 14; // 14 days
	const expires = new Date(Date.now() + ttlSeconds * 1000).toISOString();
	await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?1, ?2, ?3)')
		.bind(sessionId, userId, expires)
		.run();
	const cookie = `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Max-Age=${ttlSeconds}${cookieBaseAttrs(req)}`;
	return { sessionId, cookie };
}

function randomBase64(bytes: number): string {
	const arr = crypto.getRandomValues(new Uint8Array(bytes));
	return btoa(String.fromCharCode(...arr));
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let out = 0;
	for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return out === 0;
}

async function hashPasswordPbkdf2(password: string, saltB64: string): Promise<string> {
	const enc = new TextEncoder();
	const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));

	const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 120_000 },
		keyMaterial,
		256
	);
	const hash = new Uint8Array(bits);
	return btoa(String.fromCharCode(...hash));
}

