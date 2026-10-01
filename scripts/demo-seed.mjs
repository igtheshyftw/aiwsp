// Sample data for the demo: used by `npm run demo` (over HTTP) and by the online demo (in the browser, scripts/build-demo.mjs).
// session() returns a function (action, body) => result that calls the IMS API as one signed-in browser would.
export const DEMO_PASSWORD = 'demo-password';
// No real names: the client company is "Demo Client" and every account is named after its role.
export const DEMO_ACCOUNTS = [
 ['client-chief', 'Chief Admin of Demo Client (approves step 1)'], ['client-admin', 'User Admin of Demo Client (approves step 2)'],
 ['client-staff', 'Demo Client staff, Level 3 (submits claims, asks the Assistant)'], ['client-staff2', 'Demo Client staff, Level 3'],
 ['wsp-staff', "WSP professional on Demo Client's service team"], ['wsp-admin', 'WSP System Admin'],
];
export async function seedDemo(session, password = DEMO_PASSWORD) {
 const sys = session(); await sys('login', {username: 'wsp-admin', password});
 const client = (await sys('company.save', {name_cn: '演示客户', name_en: 'Demo Client', type: 'Client', code: 'DEMO01', city: 'Shanghai'})).id;
 const add = async (s, username, name_en, dept, extra = {}) => (await s('user.save', {companyId: client, username, name_en, sex: '', dept, password, level: 3, ...extra})).id;
 const chief = await add(sys, 'client-chief', 'Chief Admin', 'Management', {level: 1});
 await sys('company.chief', {id: client, userId: chief});
 // A WSP professional who handles the client's assistant conversations (designated on the WSP–client connection).
 const wsp = (await sys('company.list')).find(c => c.operator).id;
 const staff = (await sys('user.save', {username: 'wsp-staff', name_en: 'WSP Professional', password, level: 2})).id;
 const link = (await sys('connection.request', {companyId: wsp, to: client, users: [staff]})).id;
 await sys('logout');
 const mi = session(); await mi('login', {username: 'client-chief', password});
 const userAdmin = await add(mi, 'client-admin', 'User Admin', 'Management', {level: 2, position: 'useradmin'});
 const staffA = await add(mi, 'client-staff', 'Staff A', 'Finance');
 const staffB = await add(mi, 'client-staff2', 'Staff B', 'Finance');
 await mi('user.save', {companyId: client, username: 'client-intern', name_en: 'Intern', password, level: 4, expires: '2099-12-31', responsible_id: userAdmin});
 const team = (await mi('group.save', {companyId: client, name: 'Management Team', members: [chief, userAdmin]})).id;
 const everyone = [chief, userAdmin, staffA, staffB].map(id => ({id, rights: 'edit'}));
 const efile = async (name, color, extra = {}) => (await mi('efile.save', {name, color, participants: everyone, admins: [chief, userAdmin], ...extra})).id;
 await efile('DEMO', 'Blue', {highlight: true});
 await efile('Test', '', {highlight: true});
 const claim = await efile('Expense Claim Demo - A', 'Personalised 3', {groups: [{id: team, rights: 'edit'}]});
 await efile('Expense Claim Demo - B', 'Teal');
 const payment = await efile('Payment eFile', 'Green');
 await efile('Project summative', 'Blue', {show_amount: 0});
 await efile("Tasks that need intern's assistance", 'Teal', {show_amount: 0});
 const stages = [await efile('Finance Manager Approval', ''), await efile('Director Approval', ''), await efile('Cashier Submission', ''), await efile('Banking Approval', '')];
 await mi('efile.bulk', {op: 'my.remove', ids: stages});
 await mi('efile.steps.save', {id: claim, approval: true, steps: [{title: "Chief Admin's checking", users: [chief]}, {title: "Manager's approval", users: [userAdmin]}]});
 await mi('efile.balance.save', {id: claim, balance: '0', balance_alias: 'Amount Payable to A', notional: '0', notional_alias: 'Notional Amount Payable to A'});
 await mi('process.save', {efileId: claim, name: 'Expense Claim Demo - A', stages: [
  {efile_id: claim, executor_id: chief, auto_commit: true}, {efile_id: payment, executor_id: chief}, {efile_id: stages[0], executor_id: userAdmin},
  {efile_id: stages[1], executor_id: userAdmin}, {efile_id: stages[2], executor_id: chief}, {efile_id: stages[3], executor_id: userAdmin, confirm_balance: true}]});
 await mi('invite.create', {companyId: client, days: 30});
 await mi('connection.update', {id: link, companyId: client, status: 'connected', users: [chief]});
 // WSP's client record for Demo Client: linked to its company account, served by wsp-staff, with a WSP eFile of work for the client.
 await sys('login', {username: 'wsp-admin', password});
 const demoClient = (await sys('client.save', {code: 'DEMO01', name_cn: '演示客户', name_en: 'Demo Client', phone: '021-0000 0000',
  business: 'Investment management', account_company_id: client, team_type: 'user', users: [staff]})).id;
 const sysId = (await sys('profile.get')).id;
 const filing = (await sys('efile.save', {name: 'Demo Client - Annual Filing 2026', client_id: demoClient, share_client: true, participants: [{id: staff, rights: 'edit'}], admins: [sysId]})).id;
 const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
 await sys('item.save', {efileId: filing, name: 'Collect bank statements', responsible_id: staff, target_date: day(-3)});
 await sys('item.save', {efileId: filing, name: 'Prepare draft return', responsible_id: staff, target_date: day(1)});
 await sys('item.save', {efileId: filing, name: 'Partner review', responsible_id: staff, target_date: day(14)});
 await sys('logout');
 await mi('logout');
 const me = session(); await me('login', {username: 'client-staff', password});
 await me('item.save', {efileId: claim, name: 'A monthly claim - August', amount: '-300', item_date: '2023-09-01'});
 await me('item.save', {efileId: claim, name: 'Entertainment', amount: '200', item_date: '2023-09-01', submit: true});
 await me('item.save', {efileId: claim, name: 'Travel to supplier office', amount: '100', item_date: '2023-09-01', submit: true});
 await me('chat.start', {text: 'What documents do you need from us for this month?'});
 await me('chat.start', {text: 'When is our next filing deadline?'});
 await me('logout');
}
