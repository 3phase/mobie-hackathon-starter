const key = document.querySelector('#api-key');
const message = document.querySelector('#message');
if (new URLSearchParams(location.search).get('login') === 'success') {
  message.textContent = 'Sign-in successful. Your phone assistant can now use the starter API.';
  history.replaceState(null, '', '/');
}
async function request(path, method = 'GET') {
  const response = await fetch(path, { method, headers: { Authorization: `Bearer ${key.value}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Request failed.');
  return data;
}
function showError(error) { message.textContent = error.message; }
document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const { url } = await request('/auth/login', 'POST');
    location.assign(url);
  } catch (error) { showError(error); }
});
document.querySelector('#status').addEventListener('click', async () => {
  try {
    const user = await request('/api/me');
    message.textContent = `Connected to the mobie API (test user ${user.id ?? 'signed in'}).`;
  } catch (error) { showError(error); }
});
document.querySelector('#logout').addEventListener('click', async () => {
  try {
    await request('/api/logout', 'POST');
    message.textContent = 'Signed out of the starter. Your Auth0 browser session remains active.';
  } catch (error) { showError(error); }
});
