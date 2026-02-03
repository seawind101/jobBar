// Get the modal element
  let popup = document.getElementById("custom-popup");

  // Get the <span> element that closes the modal
  let closeBtn = document.getElementsByClassName("close-btn")[0];

  // Get the form within the modal
  let form = document.getElementById("popup-form");

  let currentJobId = null; // Store the job ID for completion

  document.addEventListener("DOMContentLoaded", function () {
    // Attach event listeners to all "Mark As Complete" buttons
    let completeButtons = document.querySelectorAll(".complete-button");
    completeButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        let jobId = this.getAttribute("data-job-id");
        openCompletePopup(jobId);
      });
    });
  });

  // Function to open the popup for a specific job
  function openCompletePopup(jobId) {
    currentJobId = jobId;
    popup.style.display = "flex"; // Use 'flex' to center the modal content
  }

  // When the user clicks on <span> (x), close the modal
  closeBtn.onclick = function () {
    popup.style.display = "none";
  }

  // When the user clicks anywhere outside of the modal, close it
  window.onclick = function (event) {
    if (event.target == popup) {
      popup.style.display = "none";
    }
  }

  // Handle the form submission
  form.addEventListener("submit", function (event) {
    event.preventDefault(); // Prevent the default form submission

    let pin = document.getElementById("pin").value;
    // prepare transfer details from the button that opened the popup
    const btn = document.querySelector(`.complete-button[data-job-id="${currentJobId}"]`);
    if (!btn) {
      alert('Job button not found');
      return;
    }
    const employeeId = btn.getAttribute('data-employee-id');
    const pay = btn.getAttribute('data-pay');
    const title = btn.getAttribute('data-title');

    // from is the manager's fb_id which the server supplies as `fb_id` variable
    const from = <%= JSON.stringify(fb_id || '') %>;
    const to = employeeId;
    const amount = pay;
    const reason = `Completed ${title}`;

    // Close the pop-up and reset UI
    popup.style.display = "none";
    form.reset(); // Reset form fields

    // call the transfer endpoint
    fetch('/api/digipogs/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, amount, reason, pin })
    }).then(r => r.json())
      .then(data => {
        console.log('Transfer response:', data);
        if (data && data.success) {
          // After successful transfer, mark the job complete on the server
          fetch(`/job/${currentJobId}/complete`, { method: 'POST' })
            .then(resp => resp.json())
            .then(js => {
              if (js && js.success) {
                // reload the page to reflect the change
                window.location.reload();
              } else {
                alert('Transfer succeeded but failed to mark job complete.');
              }
            }).catch(err => {
              console.error('Error marking job complete:', err);
              alert('Transfer succeeded but failed to mark job complete.');
            });
        } else {
          alert('Transfer failed: ' + (data.message || 'unknown'));
        }
      }).catch(err => {
        console.error('Transfer error:', err);
        alert('Transfer error');
      });
  });