// Client-side helper for deleting an élève
async function deleteEleve(id) {
  if (!confirm('Supprimer cet élève ?')) return;
  try {
    const res = await fetch('/api/eleves/' + id, { method: 'DELETE' });
    if (res.ok) {
      // reload to show updated list
      location.reload();
    } else {
      const body = await res.text();
      alert('Erreur lors de la suppression: ' + body);
    }
  } catch (err) {
    alert('Erreur réseau');
  }
}
// Client-side helper for modifying an élève
function modifieEleve(id) {
  window.location.href = '/eleves/modifie/' + id;
}
// Client-side helper for viewing an élève's bulletin (opens notes page to pick a trimestre)
function BulletinEleve(id) {
  window.location.href = '/notes/' + id;
}

// Client-side helper to open the 'add note' form for an élève
function addNoteEleve(id) {
  window.location.href = '/notes/add/' + id;
}
// Client-side helper for filtering élèves by classe
document.getElementById('classeSelect').addEventListener('change', filterEleves);

function filterEleves() {
  const selectedClasse = document.getElementById('classeSelect').value;
  const table = document.getElementById('tbl');
  const rows = table.getElementsByTagName('tr');
  for (let i = 1; i < rows.length; i++) { // start from 1 to skip header row
    const classeCell = rows[i].getElementsByTagName('td')[4]; // 4th column is classe
    if (classeCell) {
      const classe = classeCell.textContent || classeCell.innerText;
      
      if (selectedClasse === '' || classe === selectedClasse) {
        rows[i].style.display = '';
      } else {
        rows[i].style.display = 'none';
      }
    }
  }};
// Client-side helper for searching élèves by name or ID
document.getElementById('searchInput').addEventListener('keyup', searchEleves);
function searchEleves() {
  const input = document.getElementById('searchInput');
  const filter = input.value.toUpperCase();
  const table = document.getElementById('tbl');
  const rows = table.getElementsByTagName('tr');
  for (let i = 1; i < rows.length; i++) { // start from 1 to skip header row
    const nameCell = rows[i].getElementsByTagName('td')[1]; // 1st column is name
    const idCell = rows[i].getElementsByTagName('td')[0]; // 0th column is ID
    if (nameCell || idCell) {
      const name = nameCell.textContent || nameCell.innerText;
      const id = idCell.textContent || idCell.innerText;
      if (name.toUpperCase().indexOf(filter) > -1 || id.toUpperCase().indexOf(filter) > -1) {
        rows[i].style.display = '';
      } else {
        rows[i].style.display = 'none';
      }
    }}};