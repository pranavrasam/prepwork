const state = {
  user: null,
  tests: [],
  activeTest: null,
  startedAt: null
};

const $ = (selector) => document.querySelector(selector);
const testsList = $('#testsList');
const hostTests = $('#hostTests');
const profilePanel = $('#profilePanel');
const toast = $('#toast');

const sampleQuestions = [
  {
    text: 'If f(x) = x², then f\'(3) is:',
    options: ['3', '6', '9', '12'],
    answerIndex: 1,
    explanation: 'f\'(x) = 2x, so f\'(3) = 6.',
    topic: 'Calculus'
  },
  {
    text: 'The value of sin 30° is:',
    options: ['0', '1/2', '√3/2', '1'],
    answerIndex: 1,
    explanation: 'sin 30° is a standard trigonometric value equal to 1/2.',
    topic: 'Trigonometry'
  }
];

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin',
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function updateSessionUi() {
  $('#logoutBtn').classList.toggle('hidden', !state.user);
  if (state.user) {
    showToast(`Logged in as ${state.user.name} (${state.user.role})`);
  }
}

function setEditor(test = null) {
  const form = $('#testEditor');
  form.id.value = test?.id || '';
  form.title.value = test?.title || '';
  form.subject.value = test?.subject || '';
  form.durationMinutes.value = test?.durationMinutes || 60;
  form.difficulty.value = test?.difficulty || 'Medium';
  form.published.checked = test?.published ?? true;
  form.questions.value = JSON.stringify(test?.questions?.map((question) => ({
    id: question.id,
    text: question.text,
    options: question.options,
    answerIndex: question.answerIndex ?? 0,
    explanation: question.explanation || '',
    topic: question.topic || 'General'
  })) || sampleQuestions, null, 2);
}

function renderTests() {
  if (!state.tests.length) {
    testsList.innerHTML = '<p class="muted">No published tests are available yet.</p>';
  } else {
    testsList.innerHTML = state.tests
      .filter((test) => test.published)
      .map((test) => `
        <article class="test-card">
          <div class="card-meta">
            <span class="pill">${test.subject}</span>
            <span class="pill">${test.difficulty}</span>
          </div>
          <h3>${test.title}</h3>
          <p class="muted">${test.questionCount} questions · ${test.durationMinutes} minutes</p>
          <button class="button primary" data-start-test="${test.id}">Start mock test</button>
        </article>
      `)
      .join('');
  }

  hostTests.innerHTML = state.user?.role === 'host'
    ? state.tests.map((test) => `
      <div class="host-test-row">
        <div>
          <strong>${test.title}</strong>
          <p class="muted">${test.subject} · ${test.questionCount} questions · ${test.published ? 'Published' : 'Draft'}</p>
        </div>
        <div class="button-row">
          <button class="ghost" data-edit-test="${test.id}">Edit</button>
          <button class="button danger" data-delete-test="${test.id}">Delete</button>
        </div>
      </div>
    `).join('')
    : '<p class="muted">Host controls unlock after logging in with a host account.</p>';
}

async function loadTests() {
  const data = await api('/api/tests');
  state.tests = data.tests;
  renderTests();
}

async function startTest(testId) {
  const { test } = await api(`/api/tests/${testId}`);
  state.activeTest = test;
  state.startedAt = Date.now();
  $('#practice').classList.remove('hidden');
  $('#practiceTitle').textContent = test.title;
  $('#practiceMeta').textContent = `${test.subject} · ${test.durationMinutes} minutes`;
  $('#practiceForm').innerHTML = test.questions.map((question, questionIndex) => `
    <article class="question-card">
      <p class="eyebrow">${question.topic || 'General'}</p>
      <h3>${questionIndex + 1}. ${question.text}</h3>
      <div class="options">
        ${question.options.map((option, optionIndex) => `
          <label class="option">
            <input type="radio" name="${question.id}" value="${optionIndex}" />
            <span>${option}</span>
          </label>
        `).join('')}
      </div>
    </article>
  `).join('') + '<button class="button primary" type="submit">Submit and view marks</button>';
  location.hash = '#practice';
}

async function submitAttempt(event) {
  event.preventDefault();
  if (!state.activeTest) return;
  const answers = {};
  state.activeTest.questions.forEach((question) => {
    const selected = document.querySelector(`input[name="${question.id}"]:checked`);
    if (selected) answers[question.id] = Number(selected.value);
  });
  const secondsSpent = Math.round((Date.now() - state.startedAt) / 1000);
  const { attempt, profile } = await api('/api/attempts', {
    method: 'POST',
    body: { testId: state.activeTest.id, answers, secondsSpent }
  });
  showToast(`Score: ${attempt.correct}/${attempt.total} (${attempt.percent}%)`);
  renderProfile(profile);
  await loadTests();
  location.hash = '#profile';
}

function renderProfile(profile) {
  if (!profile?.user) {
    profilePanel.innerHTML = '<p class="muted">Login or sign up to see personal marks, analysis, and prediction.</p>';
    $('#heroPrediction').textContent = '82%';
    return;
  }
  $('#heroPrediction').textContent = `${profile.stats.predictedPerformance}%`;
  profilePanel.innerHTML = `
    <article class="stat-card"><span class="muted">Attempts</span><strong>${profile.stats.attempts}</strong></article>
    <article class="stat-card"><span class="muted">Average</span><strong>${profile.stats.average}%</strong></article>
    <article class="stat-card"><span class="muted">Best</span><strong>${profile.stats.best}%</strong></article>
    <article class="stat-card"><span class="muted">Prediction</span><strong>${profile.stats.predictedPerformance}%</strong></article>
    <article class="stat-card wide">
      <span class="muted">Readiness signal</span>
      <h3>${profile.stats.readiness}</h3>
      <p class="muted">Prediction combines your average score and recent practice trend.</p>
    </article>
    <article class="stat-card wide">
      <span class="muted">Topic analysis</span>
      ${profile.topics.length ? profile.topics.map((topic) => `
        <div class="topic-row">
          <strong>${topic.topic}: ${topic.percent}%</strong>
          <div class="progress"><span style="width:${topic.percent}%"></span></div>
          <small class="muted">${topic.correct}/${topic.total} correct</small>
        </div>
      `).join('') : '<p class="muted">Submit a mock test to build topic analysis.</p>'}
    </article>
    <article class="stat-card wide">
      <span class="muted">Recent attempts</span>
      ${profile.recent.length ? profile.recent.map((attempt) => `
        <div class="attempt-row">
          <strong>${attempt.testTitle}: ${attempt.percent}%</strong>
          <small class="muted">${attempt.subject} · ${attempt.correct}/${attempt.total} · ${new Date(attempt.createdAt).toLocaleString()}</small>
        </div>
      `).join('') : '<p class="muted">No attempts yet.</p>'}
    </article>
  `;
}

async function loadProfile() {
  try {
    const profile = await api('/api/profile');
    renderProfile(profile);
  } catch (error) {
    renderProfile(null);
  }
}

async function saveTest(event) {
  event.preventDefault();
  const values = formData(event.currentTarget);
  let questions;
  try {
    questions = JSON.parse(values.questions);
  } catch (error) {
    showToast('Questions must be valid JSON.');
    return;
  }
  const payload = {
    title: values.title,
    subject: values.subject,
    durationMinutes: Number(values.durationMinutes),
    difficulty: values.difficulty,
    published: event.currentTarget.published.checked,
    questions
  };
  const path = values.id ? `/api/tests/${values.id}` : '/api/tests';
  const method = values.id ? 'PUT' : 'POST';
  await api(path, { method, body: payload });
  showToast('Test saved successfully.');
  setEditor();
  await loadTests();
}

async function deleteTest(testId) {
  await api(`/api/tests/${testId}`, { method: 'DELETE' });
  showToast('Test deleted.');
  await loadTests();
}

async function bootstrap() {
  setEditor();
  try {
    const { user } = await api('/api/me');
    state.user = user;
    updateSessionUi();
  } catch (error) {
    state.user = null;
  }
  await loadTests();
  await loadProfile();
}

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const values = formData(event.currentTarget);
    const { user } = await api('/api/login', { method: 'POST', body: values });
    state.user = user;
    updateSessionUi();
    await loadTests();
    await loadProfile();
  } catch (error) {
    showToast(error.message);
  }
});

$('#signupForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const values = formData(event.currentTarget);
    const { user } = await api('/api/signup', { method: 'POST', body: values });
    state.user = user;
    updateSessionUi();
    await loadTests();
    await loadProfile();
  } catch (error) {
    showToast(error.message);
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  state.user = null;
  updateSessionUi();
  renderProfile(null);
  await loadTests();
  showToast('Logged out.');
});

$('#refreshTests').addEventListener('click', () => loadTests().catch((error) => showToast(error.message)));
$('#refreshProfile').addEventListener('click', () => loadProfile().catch((error) => showToast(error.message)));
$('#practiceForm').addEventListener('submit', (event) => submitAttempt(event).catch((error) => showToast(error.message)));
$('#testEditor').addEventListener('submit', (event) => saveTest(event).catch((error) => showToast(error.message)));
$('#newTestBtn').addEventListener('click', () => setEditor());

document.addEventListener('click', async (event) => {
  const startId = event.target.dataset.startTest;
  const editId = event.target.dataset.editTest;
  const deleteId = event.target.dataset.deleteTest;
  try {
    if (startId) await startTest(startId);
    if (editId) {
      const { test } = await api(`/api/tests/${editId}`);
      setEditor(test);
      location.hash = '#host';
    }
    if (deleteId && window.confirm('Delete this test?')) await deleteTest(deleteId);
  } catch (error) {
    showToast(error.message);
  }
});

bootstrap().catch((error) => showToast(error.message));
