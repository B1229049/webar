const hostNameInput = document.getElementById('hostName');
    const meetingTitleInput = document.getElementById('meetingTitle');
    const meetingCodeInput = document.getElementById('meetingCode');
    const resultCard = document.getElementById('resultCard');
    const resultCode = document.getElementById('resultCode');
    const resultTitle = document.getElementById('resultTitle');
    const resultHost = document.getElementById('resultHost');
    const resultLink = document.getElementById('resultLink');

    function generateMeetingCode(length = 8) {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < length; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      return code;
    }

    function buildMeetingLink(code) {
      const base = window.location.origin && window.location.origin !== 'null'
        ? window.location.origin + window.location.pathname.replace(/[^/]*$/, '')
        : './';
      return `${base}join-meeting.html?room=${encodeURIComponent(code)}`;
    }

    function ensureCode() {
      if (!meetingCodeInput.value.trim()) {
        meetingCodeInput.value = generateMeetingCode();
      }
      return meetingCodeInput.value.trim();
    }

    document.getElementById('generateBtn').addEventListener('click', () => {
      meetingCodeInput.value = generateMeetingCode();
    });

    document.getElementById('createBtn').addEventListener('click', () => {
      const hostName = hostNameInput.value.trim() || '未填寫';
      const meetingTitle = meetingTitleInput.value.trim() || '未命名會議';
      const meetingCode = ensureCode();
      const meetingLink = buildMeetingLink(meetingCode);

      const meetingData = {
        hostName,
        meetingTitle,
        meetingCode,
        meetingLink,
        createdAt: new Date().toISOString()
      };

      localStorage.setItem('latestMeeting', JSON.stringify(meetingData));

      resultCode.textContent = meetingCode;
      resultTitle.textContent = `會議名稱：${meetingTitle}`;
      resultHost.textContent = `主持人：${hostName}`;
      resultLink.textContent = meetingLink;
      resultCard.classList.add('show');
    });

    document.getElementById('copyBtn').addEventListener('click', async () => {
      const meetingCode = ensureCode();
      const meetingLink = buildMeetingLink(meetingCode);

      try {
        await navigator.clipboard.writeText(meetingLink);
        alert('已複製加入連結');
      } catch (error) {
        alert('複製失敗，請手動複製：\n' + meetingLink);
      }
    });

    meetingCodeInput.value = generateMeetingCode();